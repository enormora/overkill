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
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { createCommandLineRunner, type CommandLineRunnerDependencies } from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunCommand, RunMicrotestProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

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

const defaultRequest: RunRequest = defaultRunRequest();

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
            microtest: defaultMicrotestProfile()
        },
        reporters: null,
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

async function resolvePassingRun(command: RunCommand): Promise<Awaited<ReturnType<RunOrchestrator['resolve']>>> {
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
                seed: '42',
                shard: command.request.shard
            }
        },
        reporters: command.config.reporters,
        request: command.request,
        testPlan: createPassingPlan()
    };
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
                    resolve: resolvePassingRun,
                    run
                }));
                const result = await runner.runTests({
                    configPath: null,
                    cwd: process.cwd(),
                    request: defaultRequest
                });

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: unexpected string failure'
                ]);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() formats Error internal crashes',
            metadata: {},
            async body(scope: OverkillScope) {
                const run = testDouble.rejects<RunOrchestrator['run']>(new Error('Unexpected failure.'));
                const runner = createCommandLineRunner(createRunnerDependencies({
                    resolve: resolvePassingRun,
                    run
                }));
                const result = await runner.runTests({
                    configPath: null,
                    cwd: process.cwd(),
                    request: defaultRequest
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
