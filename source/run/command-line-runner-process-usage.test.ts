import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import type { LoadedConfig, ConfiguredRunCommand, RunCommand } from '../packages/run/run.entry-point.ts';

import { defaultFailureArtifactPolicy, type TestPlan } from '../packages/engine/engine.entry-point.ts';

import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defineFixedOutputRenderer, defineFixedReporter } from '../test-support/reporter-definition.ts';
import {
    defaultRunConfig,
    unexpectedBenchmarkOrchestrator,
    defaultMicrotestProfile,
    defaultRunRequest,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import { runnerResultFactory } from '../test-support/runner-result-factory.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import { selectTestProfile } from './test-profile.ts';

type RecordedRunCommands = {
    readonly first: () => RunCommand | undefined;
    readonly record: (command: RunCommand) => void;
};

type ConfiguredRunOrchestrator = CommandLineRunnerDependencies['orchestrator'];

const plainOutputRenderer = defineFixedOutputRenderer({
    render(intent): string {
        return intent.text;
    }
});

const terminalReporter = defineFixedReporter({
    dispose: null,
    kind: 'real-time',
    name: 'terminal',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'stdout-raw' } ]
});

const defaultRequest = defaultRunRequest();

function defaultLoadedConfig(): LoadedConfig {
    return {
        history: defaultRunConfig().history,
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

function createPassingPlan(): TestPlan {
    const engine = createTestEngine();

    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(scope) {
                        scope.assert.true(true);
                        return scope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'passes'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
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
    const orchestrator: ConfiguredRunOrchestrator = {
        bench: unexpectedBenchmarkOrchestrator,
        async resolve(suppliedCommand) {
            const { command } = snapshotRunCommand(suppliedCommand);
            const profile = selectTestProfile(command.request.profile, command.config);

            return {
                config: command.config,
                cwd: command.cwd,
                facts: {
                    implementations: null,

                    family: {
                        id: testRunExecutionFacts(command, profile).testFamily,
                        version: '1',
                        settings: null,
                        preparation: null,
                        collection: null
                    },
                    adapter: null,
                    benchmarkHost: null,
                    benchmarkCalibration: null,
                    benchmarkNormalization: null,
                    benchmarkPlacement: null,
                    coveragePolicy: null,
                    durationHistory: null,
                    cases: [],
                    environment: {
                        node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                        projectRoot: command.cwd,
                        runtimeStateDir: command.config.runtimeStateDir
                    },
                    execution: testRunExecutionFacts(command, profile),
                    loader: command.config.loader,
                    reproducibility: {
                        selectedIdentities: [],
                        selection: command.request.selection,
                        seed: '42',
                        shard: command.request.shard,
                        shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
                    }
                },
                collectionRunnerErrors: [],
                engine: command.engine,
                plan: {
                    kind: 'local',
                    testPlan: createPassingPlan()
                },
                reporters: command.config.reporters ?? [],
                request: command.request
            };
        },
        async run(suppliedCommand) {
            const { command } = snapshotRunCommand(suppliedCommand);
            recordedCommands.record(command);

            return runnerResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        },
        async runWithReporterDelivery(suppliedCommand) {
            const { command } = snapshotRunCommand(suppliedCommand);
            recordedCommands.record(command);

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

    return {
        async createDefaultReporter() {
            return terminalReporter;
        },
        async loadReplayCommands() {
            throw new Error('Replay commands are not configured.');
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        async loadConfig() {
            return {
                ...defaultLoadedConfig(),
                profiles: {
                    microtest: defaultMicrotestProfile({
                        processUsage: {
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

const assertProcessUsageCommand = defineCompositeAssertion({
    name: 'process usage command',
    assert(check, suppliedCommand: ConfiguredRunCommand | RunCommand) {
        const { command } = snapshotRunCommand(suppliedCommand);
        const profile = command.config.profiles.microtest;
        if (profile === undefined || profile === null) {
            return check.defined(profile);
        }
        const initialChecks = check.group([
            check.defined(profile),
            check.deepEqual(profile, {
                failureArtifacts: defaultFailureArtifactPolicy,
                baselines: { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' },
                coverage: {
                    outputDirectory: null,
                    outputs: [ 'v8', 'lcov' ],
                    sources: { exclude: [], mode: 'loaded' },
                    thresholds: { branches: null, functions: null, lines: null }
                },
                execution: {
                    maxConcurrency: 5,
                    processModel: 'supervised-process',
                    scheduling: 'concurrent'
                },
                files: null,
                reporters: null,
                processUsage: {
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
                runRecords: { persist: 'on-demand' },
                timings: { collection: 'summary' },
                timeouts: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                }
            })
        ]);
        const { processBudgetOverrides } = command.request;
        if (processBudgetOverrides === null) {
            return check.group([ initialChecks, check.notNull(processBudgetOverrides) ]);
        }
        return check.group([
            initialChecks,
            check.notNull(processBudgetOverrides),
            check.deepEqual(processBudgetOverrides, {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: 100,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            })
        ]);
    }
});

export const testNode = suite('Command line runner process usage', [
    test(
        'commandLineRunner.runTests() carries process usage config and request values',
        async function (scope: TestScope) {
            const recordedCommands = createRecordedRunCommands();
            const runner = createCommandLineRunner(createRunnerDependencies(recordedCommands));
            const result = await runner.runTests({
                configPath: null,
                cwd: process.cwd(),
                runRequest: {
                    ...defaultRequest,
                    processBudgetOverrides: {
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
            scope.assert(assertProcessUsageCommand, receivedCommand);

            return scope.assert.collect();
        }
    )
]);
