import { type TestScope, suite, test } from '@overkill-dev/test';

import { normalizeConfig } from '../config/config.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { readBenchmarkRunMetadata } from '../bench/benchmark-run-report.ts';
import { createBenchmarkHtmlReport } from '../reporters/benchmark-html-model.ts';
import { createRunFacts } from './run-facts.ts';
import { withBenchmarkErrorMetadata } from './benchmark-report-metadata.ts';
import type { RunCommand, ResolvedRun } from './run-types.ts';

export function metadataCommand(processModel: 'supervised-process' | 'worker-pool'): RunCommand {
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
        hostProcess: null,
        benchmarkHost: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        benchmarkPlacement: {
            policy: 'conservative-size-only-v1',
            maximumWorkers: 1,
            limits: [ { reason: 'measurement', maximumWorkers: 1 } ]
        },
        selectedIdentities: [],
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
export const testNode = suite('benchmark reporting context', [
    test('reads canonical process facts without creating metadata attachments', function (scope: TestScope) {
        for (const model of [ 'supervised-process', 'worker-pool' ] as const) {
            const facts = metadataFacts(metadataCommand(model));
            const metadata = readBenchmarkRunMetadata(facts);
            scope.require.defined(metadata);
            scope.assert.deepEqual(
                [ metadata.execution.workerCount, metadata.execution.workerLifecycle ],
                model === 'worker-pool' ? [ 2, 'reuse' ] : [ null, null ]
            );
            scope.assert.deepEqual<unknown, unknown>(metadata.placement, facts.benchmarkPlacement);
            const result = runResultFactory.build({});
            scope.assert.includes(
                createBenchmarkHtmlReport({ result, context: { id: null, startedAt: null, facts } }).metadata,
                'conservative-size-only-v1'
            );
            scope.assert.equal(result.artifacts.length, 0);
        }
        return scope.assert.collect();
    }),
    test('retains available preparation facts on benchmark failures', function (scope: TestScope) {
        const result = withBenchmarkErrorMetadata(
            runResultFactory.build({}),
            metadataCommand('supervised-process'),
            null
        );
        const metadata = readBenchmarkRunMetadata(result.preparationFacts);
        scope.require.defined(metadata);
        scope.assert.equal(metadata.execution.profile, 'startup');
        scope.assert.equal(metadata.host, null);
        scope.assert.equal(metadata.placement, null);
        scope.assert.equal(result.artifacts.length, 0);
        return scope.assert.collect();
    }),
    test('missing or unrelated facts do not fabricate benchmark context', function (scope) {
        scope.assert.equal(readBenchmarkRunMetadata(null), null);
        scope.assert.equal(readBenchmarkRunMetadata({}), null);
        const command = metadataCommand('supervised-process');
        const result = runResultFactory.build({});
        scope.assert.equal(
            withBenchmarkErrorMetadata(result, {
                ...command,
                config: normalizeConfig({
                    profiles: {
                        startup: {
                            testFamily: 'microtest'
                        }
                    }
                })
            }, null),
            result
        );
        return scope.assert.collect();
    })
]);
