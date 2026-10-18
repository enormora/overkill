import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { readBenchmarkRunMetadata, benchmarkRunMediaType } from '../bench/benchmark-run-report.ts';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';
import { createBenchmarkHtmlReport } from '../reporters/benchmark-html-model.ts';
import { createRunFacts } from './run-facts.ts';
import { withBenchmarkRunMetadata, withBenchmarkErrorMetadata } from './benchmark-report-metadata.ts';
import type { RunCommand, ResolvedRun } from './run-types.ts';

function metadataCommand(processModel: 'supervised-process' | 'worker-pool'): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                startup: {
                    testFamily: 'benchmark',
                    files: { include: [ 'fixture.bench.ts' ] },
                    execution: { processModel }
                }
            }
        }),
        cwd: '/project',
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'startup' })
    };
}
function metadataFacts(command: RunCommand): ResolvedRun['facts'] {
    return createRunFacts({
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkPlacement: {
            policy: 'conservative-size-only-v1',
            maximumWorkers: 1,
            limits: [ { reason: 'measurement', maximumWorkers: 1 } ]
        },
        cases: [],
        config: command.config,
        dependencies: {
            createSeed() {
                return 1n;
            },
            node: { arch: 'x64', platform: 'linux', version: '26.9.0' }
        },
        durationHistory: null,
        engine: command.engine,
        placementPlan: null,
        projectRoot: command.cwd,
        request: command.request,
        scheduling: 'serial',
        workerCount: { hostMaximum: 4, profileMaximum: null, requested: null, resolved: 2 }
    });
}
export const testNode = suite('benchmark run metadata', [
    test('records process facts and worker lifecycle only for worker pools', function (scope: TestScope) {
        const result = runResultFactory.build({});
        for (const processModel of [ 'supervised-process', 'worker-pool' ] as const) {
            const facts = metadataFacts(metadataCommand(processModel));
            const recorded = withBenchmarkRunMetadata(result, facts, 42);
            const metadata = readBenchmarkRunMetadata(recorded);
            scope.require.defined(metadata);
            scope.assert.partialDeepEqual(metadata, {
                node: { version: '26.9.0' },
                execution: {
                    processModel,
                    workerCount: processModel === 'worker-pool' ? 2 : null,
                    workerLifecycle: processModel === 'worker-pool' ? 'reuse' : null
                }
            });
            scope.assert.deepEqual<unknown, unknown>(metadata.placement, facts.benchmarkPlacement);
            scope.assert.deepEqual(recorded.perTest, result.perTest);
        }
        return scope.assert.collect();
    }),
    test('renders the recorded placement decision in HTML metadata', function (scope: TestScope) {
        const facts = metadataFacts(metadataCommand('worker-pool'));
        const recorded = withBenchmarkRunMetadata(runResultFactory.build({}), facts, 0);
        scope.assert.includes(createBenchmarkHtmlReport(recorded).metadata, 'conservative-size-only-v1');
        return scope.assert.collect();
    }),
    test('does not attach benchmark metadata to other test families or unknown profiles', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const command = metadataCommand('supervised-process');
        const microtest = {
            ...command,
            config: normalizeConfig({ profiles: { startup: { testFamily: 'microtest' } } })
        };
        scope.assert.equal(withBenchmarkRunMetadata(result, metadataFacts(microtest), 0), result);
        scope.assert.equal(withBenchmarkErrorMetadata(result, microtest, null), result);
        scope.assert.equal(
            withBenchmarkErrorMetadata(result, {
                ...command,
                request: { ...command.request, profile: 'unknown' }
            }, null),
            result
        );
        return scope.assert.collect();
    }),
    test('records benchmark metadata for failures before fact resolution', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const recorded = withBenchmarkErrorMetadata(result, metadataCommand('supervised-process'), null);
        const metadata = readBenchmarkRunMetadata(recorded);
        scope.require.defined(metadata);
        scope.assert.equal(metadata.node.version, process.version);
        scope.assert.equal(metadata.calibration, null);
        scope.assert.equal(metadata.execution.workerCount, null);
        scope.assert.equal(metadata.execution.profile, 'startup');
        scope.assert.includes(createBenchmarkHtmlReport(recorded).metadata, process.version);
        return scope.assert.collect();
    }),
    test('uses the default attachment limit when benchmark facts omit a limit', function (scope: TestScope) {
        const facts = metadataFacts(metadataCommand('supervised-process'));
        const recorded = withBenchmarkRunMetadata(runResultFactory.build({}), {
            ...facts,
            execution: { ...facts.execution, attachments: null }
        }, 0);
        scope.assert.equal(readBenchmarkRunMetadata(recorded)?.execution.profile, 'startup');
        scope.assert.deepEqual(recorded.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('preserves existing results and artifacts when metadata exceeds its limit', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const facts = metadataFacts(metadataCommand('supervised-process'));
        const failed = withBenchmarkRunMetadata(result, {
            ...facts,
            execution: {
                ...facts.execution,
                attachments: {
                    maxArtifactBytes: 1,
                    maxInlineBytes: 1,
                    maxScopeBytes: 1,
                    maxScopeAttachments: 1
                }
            }
        }, 0);
        scope.assert.equal(failed.status, 'failed');
        scope.assert.deepEqual(failed.perTest, result.perTest);
        scope.assert.deepEqual(failed.artifacts, result.artifacts);
        scope.assert.equal(
            failed.runnerErrors.at(-1)?.message,
            'benchmark-run report exceeds the configured artifact byte limit.'
        );
        return scope.assert.collect();
    }),
    test('rejects malformed metadata and ignores non-JSON metadata attachments', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const artifact = runJsonArtifact({
            result,
            value: { version: 99 },
            name: 'benchmark-run',
            mediaType: benchmarkRunMediaType,
            maxBytes: 4096,
            capturedAtMicroseconds: 0
        });
        scope.assert.throws(function () {
            readBenchmarkRunMetadata({ ...result, artifacts: [ artifact ] });
        }, { name: 'ZodError' });
        scope.assert.equal(
            readBenchmarkRunMetadata({
                ...result,
                artifacts: [ {
                    ...artifact,
                    payload: { ...artifact.payload, content: { kind: 'omitted', reason: 'byte-limit', limit: 1 } }
                } ]
            }),
            null
        );
        return scope.assert.collect();
    })
]);
