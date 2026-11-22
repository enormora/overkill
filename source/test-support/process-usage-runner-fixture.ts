import type { LoadedConfig, RunCommand } from '../packages/run/run.entry-point.ts';
import type { CommandLineRunnerDependencies } from '../packages/run/command-line.entry-point.ts';
import type { TestPlan } from '../packages/engine/engine.entry-point.ts';
import { snapshotRunCommand } from '../run/frozen-run-command.ts';
import { selectTestProfile } from '../run/test-profile.ts';
import { createTestEngine } from './create-test-engine.ts';
import { defineFixedOutputRenderer, defineFixedReporter } from './reporter-definition.ts';
import {
    defaultRunConfig,
    unexpectedBenchmarkOrchestrator,
    defaultMicrotestProfile,
    defaultRunRequest,
    testRunExecutionFacts
} from './run-command-factory.ts';
import { runnerResultFactory } from './runner-result-factory.ts';

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

export const defaultRequest = defaultRunRequest();

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

export function createRecordedRunCommands(): RecordedRunCommands {
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

export function createRunnerDependencies(recordedCommands: RecordedRunCommands): CommandLineRunnerDependencies {
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
