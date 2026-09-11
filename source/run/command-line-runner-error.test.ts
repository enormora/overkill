import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { testDouble } from '../doubles/test-double.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defineFixedOutputRenderer, defineFixedReporter } from '../test-support/reporter-definition.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunCommand, RunProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

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

async function loadDefaultRunConfig(): Promise<LoadedRunConfig> {
    return {
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

function selectedProfile(command: RunCommand): RunProfileConfig {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        throw new Error(`Missing profile ${command.request.profile}.`);
    }

    return profile;
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

async function resolvePassingRun(command: RunCommand): Promise<Awaited<ReturnType<RunOrchestrator['resolve']>>> {
    const profile = selectedProfile(command);

    return {
        config: command.config,
        cwd: command.cwd,
        facts: {
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: command.cwd,
                runtimeStateDir: command.config.runtimeStateDir
            },
            execution: testRunExecutionFacts(command, profile),
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
}

function createRunOnlyOrchestrator(run: RunOrchestrator['run']): RunOrchestrator {
    return {
        resolve: resolvePassingRun,
        run,
        async runWithReporterDelivery(command) {
            return {
                deliveredRunnerErrors: [],
                result: await run(command)
            };
        }
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-runner-error.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.runTests() formats non-error internal crashes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const run = testDouble.rejects<RunOrchestrator['run']>('unexpected string failure');
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.runTests() formats Error internal crashes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const run = testDouble.rejects<RunOrchestrator['run']>(new Error('Unexpected failure.'));
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
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
