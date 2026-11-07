import { runIfMain } from '#test-runner';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    unexpectedBenchmarkOrchestrator,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { runnerResultFactory } from '../test-support/runner-result-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunner
} from './command-line-runner.ts';
import type { ConfiguredRunOrchestrator } from './run-types.ts';

const fixtureCwd = '/project';

const singletonRunRequest = defaultRunRequest({
    capabilityRestrictions: { mode: 'disabled' },
    order: 'plan',
    paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
    seed: { value: 42n }
});

const memoryReporter = defineReporter(function createMemoryReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'memory',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

function createPassingOrchestrator(): ConfiguredRunOrchestrator {
    return {
        bench: unexpectedBenchmarkOrchestrator,
        async resolve() {
            throw new Error('List resolution is not used.');
        },
        async run() {
            return runnerResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        },
        async runWithReporterDelivery() {
            return {
                deliveredRunnerErrors: [],
                result: runnerResultFactory.build({
                    perTest: [ { outcome: { kind: 'pass' } } ],
                    summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
                }),
                undeliveredRunnerErrors: []
            };
        }
    };
}

function createTestRunner(): CommandLineRunner {
    const config = defaultRunConfig();

    return createCommandLineRunner({
        async createDefaultReporter() {
            return memoryReporter;
        },
        async loadReplayCommands() {
            throw new Error('Replay commands are not configured.');
        },
        async loadBaselineCommands() {
            throw new Error('Baseline loader is unused in this test.');
        },
        async loadBenchmarkCommands() {
            const { createBenchmarkCommands } = await import('./benchmark-commands.ts');

            return createBenchmarkCommands({
                async createDefaultReporter() {
                    return memoryReporter;
                },
                async loadConfig() {
                    return { ...config, configPath: null };
                },
                orchestrator: createPassingOrchestrator()
            });
        },
        async loadConfig() {
            return {
                history: defaultRunConfig().history,
                configPath: null,
                loader: config.loader,
                outputRenderer: config.outputRenderer,
                profiles: config.profiles,
                reporters: null,
                runtimeStateDir: config.runtimeStateDir
            };
        },
        orchestrator: createPassingOrchestrator()
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-defaults.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner rejects benchmark selection without configured benchmark profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await createTestRunner().bench.listBenchmarks({
                    configPath: null,
                    cwd: fixtureCwd,
                    listRequest: {
                        lastFailed: false,
                        order: 'seeded',
                        paths: [],
                        profile: null,
                        seed: { value: null },
                        selection: { kind: 'all' },
                        shard: { index: 1, total: 1 },
                        withLocations: false,
                        withOrphans: false
                    }
                });

                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: No benchmark profiles are configured. Configure a benchmark profile and use --profile.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner singleton runs tests with the default reporter',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await createTestRunner().runTests({
                    configPath: null,
                    cwd: fixtureCwd,
                    runRequest: singletonRunRequest
                });

                scope.assert.equal(result.exitCode, 0);
                scope.assert.deepEqual(result.fallbackDiagnostics, []);
                scope.assert.deepEqual(result.stdoutLines, []);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
