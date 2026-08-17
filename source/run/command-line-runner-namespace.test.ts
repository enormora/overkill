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
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    commandLineRunner,
    createCommandLineRunner,
    type CommandLineBaselineCommands,
    type CommandLineBenchmarkCommands,
    type CommandLineCommand,
    type CommandLineCommandContext,
    type CommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { RunOrchestrator, RunRequest } from './run.ts';
import type { LoadedRunConfig } from './run-config.ts';

type CommandFamilyLoaders = Pick<
    CommandLineRunnerDependencies,
    'loadBaselineCommands' | 'loadBenchmarkCommands'
>;

type SelectedCommandResults = {
    readonly baseline: CommandLineRunnerResult;
    readonly benchmark: CommandLineRunnerResult;
    readonly run: CommandLineRunnerResult;
};

type CommandResultExpectation = {
    readonly label: string;
    readonly result: CommandLineRunnerResult;
};

const memoryReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { conflictPolicy: 'shared', kind: 'memory' } ]
};

const defaultRequest: RunRequest = {
    baselineUpdateMode: 'none',
    capture: 'buffered',
    coverage: false,
    debug: {
        mode: 'off',
        selectors: []
    },
    execution: { mode: 'concurrent-in-process' },
    order: 'plan',
    paths: [],
    profile: 'microtest',
    seed: { value: 42n },
    selection: { kind: 'all' },
    shard: { index: 0, total: 1 },
    verbose: false
};

function defaultCommandContext(): CommandLineCommandContext {
    return {
        arguments: [],
        configPath: null,
        cwd: process.cwd()
    };
}

async function loadDefaultRunConfig(): Promise<LoadedRunConfig> {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        reporters: null,
        runtimeStateDir: '.overkill'
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

function commandResult(label: string): CommandLineRunnerResult {
    return {
        exitCode: 3,
        fallbackDiagnostics: [ label ],
        runResult: null
    };
}

function namedCommand(label: string): CommandLineCommand {
    return async function runNamedCommand() {
        return commandResult(label);
    };
}

function namedBaselineCommands(namespace: string): CommandLineBaselineCommands {
    return {
        apply: namedCommand(`${namespace} apply`),
        bootstrap: namedCommand(`${namespace} bootstrap`),
        diff: namedCommand(`${namespace} diff`),
        list: namedCommand(`${namespace} list`),
        update: namedCommand(`${namespace} update`)
    };
}

function namedBenchmarkCommands(): CommandLineBenchmarkCommands {
    return {
        baseline: namedBaselineCommands('bench baseline'),
        listBenchmarks: namedCommand('bench list'),
        runBenchmarks: namedCommand('bench run')
    };
}

function createRunnerDependencies(commandLoaders: CommandFamilyLoaders): CommandLineRunnerDependencies {
    const orchestrator: RunOrchestrator = {
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
        async run() {
            return runResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        }
    };

    return {
        async createDefaultReporter() {
            return memoryReporter;
        },
        loadBaselineCommands: commandLoaders.loadBaselineCommands,
        loadBenchmarkCommands: commandLoaders.loadBenchmarkCommands,
        loadRunConfig: loadDefaultRunConfig,
        orchestrator
    };
}

async function runSelectedCommands(runner: CommandLineRunner): Promise<SelectedCommandResults> {
    return {
        baseline: await runner.baseline.update(defaultCommandContext()),
        benchmark: await runner.bench.listBenchmarks(defaultCommandContext()),
        run: await runner.runTests({
            configPath: null,
            cwd: process.cwd(),
            request: defaultRequest,
            testPlan: createPassingPlan()
        })
    };
}

async function commandExpectations(runner: CommandLineRunner): Promise<readonly CommandResultExpectation[]> {
    return [
        { label: 'baseline apply', result: await runner.baseline.apply(defaultCommandContext()) },
        { label: 'baseline bootstrap', result: await runner.baseline.bootstrap(defaultCommandContext()) },
        { label: 'baseline diff', result: await runner.baseline.diff(defaultCommandContext()) },
        { label: 'baseline list', result: await runner.baseline.list(defaultCommandContext()) },
        { label: 'bench baseline apply', result: await runner.bench.baseline.apply(defaultCommandContext()) },
        { label: 'bench baseline bootstrap', result: await runner.bench.baseline.bootstrap(defaultCommandContext()) },
        { label: 'bench baseline diff', result: await runner.bench.baseline.diff(defaultCommandContext()) },
        { label: 'bench baseline list', result: await runner.bench.baseline.list(defaultCommandContext()) },
        { label: 'bench baseline update', result: await runner.bench.baseline.update(defaultCommandContext()) },
        { label: 'bench run', result: await runner.bench.runBenchmarks(defaultCommandContext()) }
    ];
}

function assertCommandResults(scope: OverkillScope, expectations: readonly CommandResultExpectation[]): void {
    for (const expectation of expectations) {
        scope.assert.deepEqual(expectation.result.fallbackDiagnostics, [ expectation.label ]);
    }
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-namespace.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'commandLineRunner direct command stubs return argument errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const runner = createCommandLineRunner(createRunnerDependencies({
                    async loadBaselineCommands() {
                        throw new Error('Baseline commands should not load.');
                    },
                    async loadBenchmarkCommands() {
                        throw new Error('Benchmark commands should not load.');
                    }
                }));
                const result = await runner.listTests(defaultCommandContext());
                const replayResult = await runner.replayRun({
                    arguments: [ 'run-1' ],
                    configPath: null,
                    cwd: process.cwd()
                });

                scope.assert.equal(result.exitCode, 3);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Command "list" is not implemented yet.'
                ]);
                scope.assert.deepEqual(replayResult.fallbackDiagnostics, [
                    'Overkill argument error: Command "replay" with 1 arguments is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner loads only the selected command family',
            metadata: {},
            async body(scope: OverkillScope) {
                let baselineLoadCount = 0;
                let benchmarkLoadCount = 0;
                const runner = createCommandLineRunner(createRunnerDependencies({
                    async loadBaselineCommands() {
                        baselineLoadCount += 1;
                        return namedBaselineCommands('baseline');
                    },
                    async loadBenchmarkCommands() {
                        benchmarkLoadCount += 1;
                        return namedBenchmarkCommands();
                    }
                }));
                const results = await runSelectedCommands(runner);

                scope.assert.equal(results.run.exitCode, 0);
                scope.assert.equal(baselineLoadCount, 1);
                scope.assert.equal(benchmarkLoadCount, 1);
                scope.assert.deepEqual(results.baseline.fallbackDiagnostics, [ 'baseline update' ]);
                scope.assert.deepEqual(results.benchmark.fallbackDiagnostics, [ 'bench list' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner routes every command family method',
            metadata: {},
            async body(scope: OverkillScope) {
                let benchmarkLoadCount = 0;
                const runner = createCommandLineRunner(createRunnerDependencies({
                    async loadBaselineCommands() {
                        return namedBaselineCommands('baseline');
                    },
                    async loadBenchmarkCommands() {
                        benchmarkLoadCount += 1;
                        return namedBenchmarkCommands();
                    }
                }));

                assertCommandResults(scope, await commandExpectations(runner));
                scope.assert.equal(benchmarkLoadCount, 6);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner singleton loads unimplemented command families',
            metadata: {},
            async body(scope: OverkillScope) {
                const baseline = await commandLineRunner.baseline.update(defaultCommandContext());
                const benchmark = await commandLineRunner.bench.runBenchmarks(defaultCommandContext());

                scope.assert.deepEqual(baseline.fallbackDiagnostics, [
                    'Overkill argument error: Command "baseline update" is not implemented yet.'
                ]);
                scope.assert.deepEqual(benchmark.fallbackDiagnostics, [
                    'Overkill argument error: Command "bench run" is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
