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
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const defaultConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-validation.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects invalid sharding',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const invalidShardCases = [
                    { message: 'Shard total must be a positive safe integer.', shard: { index: 1, total: 0 } },
                    { message: 'Shard total must be a positive safe integer.', shard: { index: 1, total: 1.5 } },
                    { message: 'Shard index must be a positive safe integer.', shard: { index: 0, total: 2 } },
                    { message: 'Shard index must be a positive safe integer.', shard: { index: 1.5, total: 2 } },
                    { message: 'Shard index must not exceed shard total.', shard: { index: 3, total: 2 } }
                ] as const;

                for (const invalidShardCase of invalidShardCases) {
                    await scope.assert.rejects(async function resolveInvalidShard() {
                        await runOrchestrator.resolve(createRunCommand({
                            config: defaultConfig,
                            cwd: process.cwd(),
                            engine: { kind: 'default' },
                            request: { ...defaultRequest, shard: invalidShardCase.shard }
                        }));
                    }, { message: invalidShardCase.message });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() rejects invalid requests before collection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function runInvalidRequest() {
                    await runOrchestrator.run(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: { ...defaultRequest, seed: { value: -1n } }
                    }));
                }, { message: 'Run seed must be a nonnegative bigint.' });
                await scope.assert.rejects(async function runInvalidSelectionRequest() {
                    await runOrchestrator.run(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            selection: { kind: 'missing' } as unknown as RunRequest['selection']
                        }
                    }));
                }, { message: 'Run selection kind is unknown.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
