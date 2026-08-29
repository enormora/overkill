import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunCommand, RunMicrotestProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

type PlainOutputIntent = {
    readonly text: string;
};

type RecordedRunCommands = {
    readonly first: () => RunCommand | undefined;
    readonly record: (command: RunCommand) => void;
};

const plainOutputRenderer = {
    render(intent: PlainOutputIntent): string {
        return intent.text;
    }
};

const terminalReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'terminal',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'stdout-raw' } ]
};

const defaultRequest: RunRequest = defaultRunRequest();

function defaultLoadedConfig(): LoadedRunConfig {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: plainOutputRenderer,
        profiles: {
            microtest: defaultMicrotestProfile()
        },
        reporters: [ terminalReporter ],
        runtimeStateDir: '.overkill'
    };
}

function selectedProfile(command: RunCommand): RunMicrotestProfileConfig {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        throw new Error(`Missing profile ${command.request.profile}.`);
    }

    return profile;
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

function createRecordedRunCommands(): RecordedRunCommands {
    const commands: RunCommand[] = [];

    return {
        first() {
            return commands[0];
        },
        record(command) {
            commands.push(command);
        }
    };
}

function createRunnerDependencies(recordedCommands: RecordedRunCommands): CommandLineRunnerDependencies {
    const orchestrator: RunOrchestrator = {
        async resolve(command) {
            const profile = selectedProfile(command);

            return {
                config: command.config,
                cwd: command.cwd,
                facts: {
                    cases: [],
                    environment: {
                        node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                        runtimeStateDir: command.config.runtimeStateDir
                    },
                    execution: {
                        baselineUpdateMode: command.request.baselineUpdateMode,
                        capture: command.request.capture,
                        debug: command.request.debug,
                        engine: { kind: 'default' },
                        order: command.request.order,
                        processModel: profile.execution.processModel,
                        profile: command.request.profile,
                        resourceUsagePolicy: profile.resourceUsage,
                        scheduling: profile.execution.scheduling,
                        testFamily: profile.testFamily,
                        timeoutPolicy: profile.timeouts,
                        verbose: command.request.verbose
                    },
                    loader: command.config.loader,
                    reproducibility: {
                        selection: command.request.selection,
                        seed: '42',
                        shard: command.request.shard
                    }
                },
                collectionRunnerErrors: [],
                engine: command.engine,
                plan: {
                    kind: 'local',
                    testPlan: createPassingPlan()
                },
                reporters: command.config.reporters,
                request: command.request
            };
        },
        async run(command) {
            recordedCommands.record(command);

            return runResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        },
        async runWithReporterDelivery(command) {
            recordedCommands.record(command);

            return {
                deliveredRunnerErrors: [],
                result: runResultFactory.build({
                    perTest: [ { outcome: { kind: 'pass' } } ],
                    summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
                })
            };
        }
    };

    return {
        async createDefaultReporter() {
            return terminalReporter;
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        async loadRunConfig() {
            return {
                ...defaultLoadedConfig(),
                profiles: {
                    microtest: defaultMicrotestProfile({
                        resourceUsage: {
                            budgets: {
                                activeResourceCount: 2,
                                residentSetBytes: 200
                            },
                            measure: true,
                            samplingIntervalMilliseconds: 25
                        }
                    })
                }
            };
        },
        orchestrator
    };
}

function assertResourceUsageCommand(scope: OverkillScope, command: RunCommand): void {
    const profile = command.config.profiles.microtest;

    scope.require.defined(profile);
    scope.assert.deepEqual(profile, {
        execution: {
            processModel: 'supervised-process',
            scheduling: 'concurrent'
        },
        files: null,
        reporters: null,
        resourceUsage: {
            budgets: {
                activeResourceCount: 2,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: 200,
                residentSetGrowthBytesPerSecond: null
            },
            measure: true,
            samplingIntervalMilliseconds: 25
        },
        testFamily: 'microtest',
        timeouts: {
            collectionMilliseconds: 1000,
            hardMilliseconds: 1000,
            softMilliseconds: 500
        }
    });
    const { resourceBudgetOverrides } = command.request;

    scope.require.notNull(resourceBudgetOverrides);
    scope.assert.deepEqual(resourceBudgetOverrides, {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: 100,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-resource-usage.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() carries resource usage config and request values',
            metadata: {},
            async body(scope: OverkillScope) {
                const recordedCommands = createRecordedRunCommands();
                const runner = createCommandLineRunner(createRunnerDependencies(recordedCommands));
                const result = await runner.runTests({
                    configPath: null,
                    cwd: process.cwd(),
                    runRequest: {
                        ...defaultRequest,
                        resourceBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: 100,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        }
                    }
                });

                scope.assert.equal(result.exitCode, 0);
                const receivedCommand = recordedCommands.first();
                scope.require.defined(receivedCommand);
                assertResourceUsageCommand(scope, receivedCommand);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
