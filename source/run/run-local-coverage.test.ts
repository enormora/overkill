import { createSuite, createTestCase, type TestScope, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { withCoverageRecordFixture } from '../test-support/coverage-record-fixture.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { createDeterministicRunTestModuleLoader } from '../test-support/deterministic-run-fixtures.ts';
import { createCoverageRunRecord } from './coverage-run-record.ts';
import { configuredFilesRunCollectionSource } from './run-collection-source.ts';
import { executeCoverageLocalRun } from './run-local-coverage.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';

const passingFile = 'source/integration-tests/run/fixtures/passing.test.ts';
const scenarios = [
    { file: passingFile, mode: 'enabled', missingSelection: false, shard: { index: 1, total: 1 }, status: 'passed' },
    {
        file: 'source/integration-tests/run/fixtures/throws-on-import.test.ts',
        mode: 'enabled',
        missingSelection: false,
        shard: { index: 1, total: 1 },
        status: 'failed'
    },
    { file: passingFile, mode: 'disabled', missingSelection: true, shard: { index: 1, total: 1 }, status: 'failed' },
    { file: passingFile, mode: 'disabled', missingSelection: false, shard: { index: 1, total: 2 }, status: 'passed' },
    { file: passingFile, mode: 'disabled', missingSelection: false, shard: { index: 2, total: 2 }, status: 'passed' }
] as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-local-coverage.test.ts',
    annotations: {},
    controls: {},
    children: scenarios.map(function localCoverageTest(scenario) {
        const { file } = scenario;
        return createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: `local coverage checkpoints ${file} with ${scenario.mode} restrictions, ` +
                `selection ${scenario.missingSelection} and shard ${scenario.shard.index}/${scenario.shard.total}`,
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                return await withCoverageRecordFixture(
                    defaultRunConfig({
                        profiles: { microtest: defaultMicrotestProfile({ execution: { processModel: 'in-process' } }) }
                    }),
                    [],
                    async function assertLocalCheckpoint(fixture) {
                        const input = {
                            ...fixture.request.input,
                            request: {
                                ...fixture.request.input.request,
                                capabilityRestrictions: { mode: scenario.mode },
                                selection: scenario.missingSelection
                                    ? {
                                        kind: 'filter' as const,
                                        filter: {
                                            field: 'title' as const,
                                            kind: 'equals' as const,
                                            value: 'missing test'
                                        }
                                    }
                                    : { kind: 'all' as const },
                                shard: scenario.shard
                            },
                            files: [ { file, fileSet: null, href: `virtual:${file}`, path: file } ] as const
                        };
                        const dependencies = {
                            ...fixture.request.dependencies,
                            loadRunTestModules: createDeterministicRunTestModuleLoader({
                                recordLoadEnvironmentMutation() {
                                    return undefined;
                                }
                            })
                        };
                        const attempt = await createCoverageRunRecord(process.cwd(), input, dependencies, null);
                        await attempt.start();
                        const result = await executeCoverageLocalRun({
                            command: { ...fixture.request.command, request: input.request },
                            dependencies,
                            input,
                            record: attempt.record,
                            session: {
                                childProcess: null,
                                async dispose() {
                                    return undefined;
                                },
                                async finalize(coverageResult: RunResult) {
                                    return coverageResult;
                                }
                            },
                            source: configuredFilesRunCollectionSource,
                            timing: createRunTimingMeasurement(dependencies.wallClock)
                        });
                        scope.assert.equal(result.status, scenario.status);
                        scope.assert.equal(fixture.records.at(-1)?.status, 'started');
                        scope.assert.equal(fixture.records.at(-1)?.result?.status, result.status);
                        return scope.assert.collect();
                    }
                );
            }
        });
    })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
