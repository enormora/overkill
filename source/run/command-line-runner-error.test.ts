import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { testDouble } from '../doubles/test-double.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunOrchestrator, RunRequest } from './run.ts';

const memoryReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
};

const defaultRequest: RunRequest = {
    baselineUpdateMode: 'none',
    capture: 'buffered',
    coverage: false,
    debug: { mode: 'off', selectors: [] },
    execution: { mode: 'concurrent-in-process' },
    measureResourceUsage: null,
    order: 'plan',
    paths: [],
    profile: 'microtest',
    resourceBudgetOverrides: null,
    resourceUsageSamplingIntervalMilliseconds: null,
    seed: { value: 42n },
    selection: { kind: 'all' },
    shard: { index: 0, total: 1 },
    verbose: false
};

async function loadDefaultRunConfig(): Promise<LoadedRunConfig> {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: {
            render() {
                return '';
            }
        },
        profiles: {
            microtest: {
                measureResourceUsage: false,
                resourceBudgets: {
                    activeResourceCount: null,
                    javaScriptEngineHeapBytes: null,
                    residentSetBytes: null,
                    residentSetGrowthBytesPerSecond: null
                },
                resourceUsageSamplingIntervalMilliseconds: 100
            }
        },
        reporters: null,
        runtimeStateDir: '.overkill'
    };
}

function createRunnerDependencies(orchestrator: RunOrchestrator): CommandLineRunnerDependencies {
    return {
        async createDefaultReporter() {
            return memoryReporter;
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        loadRunConfig: loadDefaultRunConfig,
        orchestrator
    };
}

function createPassingPlan(): TestPlan {
    const engine = createTestEngine();

    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body(scope) {
                        scope.assert.true(true);

                        return scope.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-error.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() formats non-error internal crashes',
            metadata: {},
            async body(scope: OverkillScope) {
                const run = testDouble.rejects<RunOrchestrator['run']>('unexpected string failure');
                const runner = createCommandLineRunner(createRunnerDependencies({
                    async resolve(command) {
                        return {
                            config: command.config,
                            facts: {
                                cases: [],
                                environment: {
                                    node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                                    runtimeStateDir: command.config.runtimeStateDir
                                },
                                execution: {
                                    baselineUpdateMode: command.request.baselineUpdateMode,
                                    capture: command.request.capture,
                                    coverage: command.request.coverage,
                                    debug: command.request.debug,
                                    mode: command.request.execution.mode,
                                    order: command.request.order,
                                    profile: command.request.profile,
                                    resourceUsagePolicy: command.config.profiles.microtest,
                                    verbose: command.request.verbose
                                },
                                loader: command.config.loader,
                                reproducibility: {
                                    seed: '42',
                                    shard: command.request.shard
                                }
                            },
                            reporters: command.config.reporters,
                            request: command.request,
                            testPlan: command.testPlan
                        };
                    },
                    run
                }));
                const result = await runner.runTests({
                    configPath: null,
                    cwd: process.cwd(),
                    request: defaultRequest,
                    testPlan: createPassingPlan()
                });

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: unexpected string failure'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
