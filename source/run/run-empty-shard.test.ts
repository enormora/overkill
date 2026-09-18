import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { executeEmptyShardRun } from './run-empty-shard.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function inProcessMicrotestConfig(): RunConfig {
    return defaultRunConfig({
        profiles: {
            microtest: defaultMicrotestProfile({
                execution: { processModel: 'in-process' }
            })
        }
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-empty-shard.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports in-process empty shards as passing',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const results = await Promise.all([ 1, 2 ].map(async function runShard(index) {
                    return await runOrchestrator.run(createRunCommand({
                        config: inProcessMicrotestConfig(),
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: defaultRunRequest({
                            paths: [ passingFixturePath ],
                            shard: { index, total: 2 }
                        })
                    }));
                }));
                const emptyShard = results.find(function isEmptyShard(result) {
                    return result.planStatus === 'empty-shard';
                });
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: inProcessMicrotestConfig(),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ paths: [ passingFixturePath ] })
                }));

                scope.require.defined(emptyShard);
                scope.assert.equal(emptyShard.status, 'passed');
                scope.assert.equal(emptyShard.summary.planned, 0);
                scope.assert.deepEqual(emptyShard.runnerErrors, []);
                await scope.assert.rejects(async function executeNonEmptyShardPlan() {
                    await executeEmptyShardRun(
                        resolvedRun,
                        {} as unknown as RunOrchestratorDependencies,
                        null
                    );
                }, { message: 'Empty shard execution requires an empty-shard collected plan.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
