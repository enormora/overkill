import { createFactory } from '@enormora/objectory';
import { doubleUsage, testDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import type {
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineCommand,
    CommandLineCommandContext,
    CommandLineRunnerResult
} from './command-line-command.ts';
import {
    createCommandLineCommandNamespace
} from './command-line-command-namespace.ts';

type LoadBaselineCommands = () => Promise<CommandLineBaselineCommands>;
type LoadBenchmarkCommands = () => Promise<CommandLineBenchmarkCommands>;

const commandLineCommandContextFactory = createFactory<CommandLineCommandContext>(
    function createCommandLineCommandContext() {
        return {
            arguments: [],
            configPath: null,
            cwd: process.cwd()
        };
    }
);

type CommandLineRunnerResultData = {
    readonly exitCode: CommandLineRunnerResult['exitCode'];
    readonly fallbackDiagnostics: readonly string[];
    readonly runResult: null;
    readonly stdoutLines: readonly string[];
};

const commandLineRunnerResultFactory = createFactory<CommandLineRunnerResultData>(
    function createCommandLineRunnerResult() {
        return {
            exitCode: 3,
            fallbackDiagnostics: [ 'command ran' ],
            runResult: null,
            stdoutLines: []
        };
    }
);

function createCommandReturningDiagnostic(diagnostic: string): CommandLineCommand {
    return async function runCommand() {
        return commandLineRunnerResultFactory.build({
            fallbackDiagnostics: [ diagnostic ]
        });
    };
}

const baselineCommandsFactory = createFactory<CommandLineBaselineCommands>(function createBaselineCommands() {
    return {
        apply: createCommandReturningDiagnostic('baseline apply'),
        bootstrap: createCommandReturningDiagnostic('baseline bootstrap'),
        diff: createCommandReturningDiagnostic('baseline diff'),
        list: createCommandReturningDiagnostic('baseline list'),
        update: createCommandReturningDiagnostic('baseline update')
    };
});

const benchmarkBaselineCommandsFactory = baselineCommandsFactory.withOverrides({
    apply: createCommandReturningDiagnostic('bench baseline apply'),
    bootstrap: createCommandReturningDiagnostic('bench baseline bootstrap'),
    diff: createCommandReturningDiagnostic('bench baseline diff'),
    list: createCommandReturningDiagnostic('bench baseline list'),
    update: createCommandReturningDiagnostic('bench baseline update')
});

const benchmarkCommandsFactory = createFactory<CommandLineBenchmarkCommands>(function createBenchmarkCommands() {
    return {
        baseline: benchmarkBaselineCommandsFactory,
        listBenchmarks: createCommandReturningDiagnostic('bench list'),
        runBenchmarks: createCommandReturningDiagnostic('bench run')
    };
});

export const testSuite = createOverkillSuite({
    title: 'source/run/command-line-command-namespace.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'command namespace loads only selected command families',
            metadata: {},
            async body(scope: OverkillScope) {
                const loaders = {
                    loadBaselineCommands: testDouble.resolves<LoadBaselineCommands>(baselineCommandsFactory.build()),
                    loadBenchmarkCommands: testDouble.resolves<LoadBenchmarkCommands>(benchmarkCommandsFactory.build())
                };
                const commands = createCommandLineCommandNamespace(loaders);
                const baseline = await commands.baseline.update(commandLineCommandContextFactory.build());
                const benchmark = await commands.bench.listBenchmarks(commandLineCommandContextFactory.build());

                scope.assert(doubleUsage.callCount, loaders.loadBaselineCommands, 1);
                scope.assert(doubleUsage.callCount, loaders.loadBenchmarkCommands, 1);
                scope.assert.deepEqual(baseline.fallbackDiagnostics, [ 'baseline update' ]);
                scope.assert.deepEqual(benchmark.fallbackDiagnostics, [ 'bench list' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'command namespace routes every lazy command method',
            metadata: {},
            async body(scope: OverkillScope) {
                const loaders = {
                    loadBaselineCommands: testDouble.resolves<LoadBaselineCommands>(baselineCommandsFactory.build()),
                    loadBenchmarkCommands: testDouble.resolves<LoadBenchmarkCommands>(benchmarkCommandsFactory.build())
                };
                const commands = createCommandLineCommandNamespace(loaders);
                const context = commandLineCommandContextFactory.build();
                const results = await Promise.all([
                    commands.baseline.apply(context),
                    commands.baseline.bootstrap(context),
                    commands.baseline.diff(context),
                    commands.baseline.list(context),
                    commands.baseline.update(context),
                    commands.bench.baseline.apply(context),
                    commands.bench.baseline.bootstrap(context),
                    commands.bench.baseline.diff(context),
                    commands.bench.baseline.list(context),
                    commands.bench.baseline.update(context),
                    commands.bench.listBenchmarks(context),
                    commands.bench.runBenchmarks(context)
                ]);
                const diagnostics = results.map(function readFallbackDiagnostic(result) {
                    return result.fallbackDiagnostics[0];
                });

                scope.assert.deepEqual(diagnostics, [
                    'baseline apply',
                    'baseline bootstrap',
                    'baseline diff',
                    'baseline list',
                    'baseline update',
                    'bench baseline apply',
                    'bench baseline bootstrap',
                    'bench baseline diff',
                    'bench baseline list',
                    'bench baseline update',
                    'bench list',
                    'bench run'
                ]);
                scope.assert(doubleUsage.callCount, loaders.loadBaselineCommands, 5);
                scope.assert(doubleUsage.callCount, loaders.loadBenchmarkCommands, 7);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
