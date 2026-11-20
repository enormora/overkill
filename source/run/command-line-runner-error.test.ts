import { type TestNode, suite, test, testDouble } from '@overkill-dev/test';

import type { LoadedConfig, ConfiguredRunCommand, RunCommand, RunRequest } from '../packages/run/run.entry-point.ts';
import type { TestPlan } from '../packages/engine/engine.entry-point.ts';

import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defineFixedOutputRenderer, defineFixedReporter } from '../test-support/reporter-definition.ts';
import {
    defaultRunConfig,
    unexpectedBenchmarkOrchestrator,
    defaultMicrotestProfile,
    defaultRunRequest,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import { selectTestProfile } from './test-profile.ts';

type ConfiguredRunOrchestrator = CommandLineRunnerDependencies['orchestrator'];

const memoryReporter = defineFixedReporter({
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
});

const defaultRequest: RunRequest = defaultRunRequest();

async function loadDefaultRunConfig(): Promise<LoadedConfig> {
    return {
        history: defaultRunConfig().history,
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: defineFixedOutputRenderer({
            render() {
                return '';
            }
        }),
        profiles: {
            microtest: defaultMicrotestProfile()
        },
        reporters: null,
        runtimeStateDir: '.overkill'
    };
}

function createRunnerDependencies(orchestrator: ConfiguredRunOrchestrator): CommandLineRunnerDependencies {
    return {
        async createDefaultReporter() {
            return memoryReporter;
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
        loadConfig: loadDefaultRunConfig,
        orchestrator
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

async function resolvePassingRun(
    suppliedCommand: ConfiguredRunCommand | RunCommand
): Promise<Awaited<ReturnType<ConfiguredRunOrchestrator['resolve']>>> {
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
}

function createRunOnlyOrchestrator(run: ConfiguredRunOrchestrator['run']): ConfiguredRunOrchestrator {
    return {
        bench: unexpectedBenchmarkOrchestrator,
        resolve: resolvePassingRun,
        run,
        async runWithReporterDelivery(suppliedCommand) {
            const { command } = snapshotRunCommand(suppliedCommand);
            return {
                deliveredRunnerErrors: [],
                result: await run(command),
                undeliveredRunnerErrors: []
            };
        }
    };
}

export const testNode: TestNode = suite('Command line runner error', [
    test('commandLineRunner.runTests() formats non-error internal crashes', async function (scope) {
        const run = testDouble.rejects<ConfiguredRunOrchestrator['run']>('unexpected string failure');
        const runner = createCommandLineRunner(createRunnerDependencies(createRunOnlyOrchestrator(run)));
        const result = await runner.runTests({
            configPath: null,
            cwd: process.cwd(),
            runRequest: defaultRequest
        });

        scope.assert.equal(result.exitCode, 70);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill internal error: unexpected string failure'
        ]);
        return scope.assert.collect();
    }),
    test('commandLineRunner.runTests() formats Error internal crashes', async function (scope) {
        const run = testDouble.rejects<ConfiguredRunOrchestrator['run']>(new Error('Unexpected failure.'));
        const runner = createCommandLineRunner(createRunnerDependencies(createRunOnlyOrchestrator(run)));
        const result = await runner.runTests({
            configPath: null,
            cwd: process.cwd(),
            runRequest: defaultRequest
        });

        scope.assert.equal(result.exitCode, 70);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill internal error: Unexpected failure.'
        ]);
        return scope.assert.collect();
    })
]);
