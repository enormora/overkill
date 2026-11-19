import { type TestScope as OverkillScope, suite, test, doubleUsage, testDouble } from '@overkill-dev/test';

import { createFactory } from '@enormora/objectory';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';

import type {
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineBenchmarkBaselineCommands,
    CommandLineCommandContext,
    CommandLineRunnerResult
} from './command-line-command.ts';
import { createCommandLineCommandNamespace } from './command-line-native-loaders.entry-point.ts';

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

function createCommandReturningDiagnostic(diagnostic: string): () => Promise<CommandLineRunnerResult> {
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

const benchmarkBaselineCommandsFactory = createFactory<CommandLineBenchmarkBaselineCommands>(function () {
    return {
        apply: createCommandReturningDiagnostic('bench baseline apply'),
        bootstrap: createCommandReturningDiagnostic('bench baseline bootstrap'),
        diff: createCommandReturningDiagnostic('bench baseline diff'),
        list: createCommandReturningDiagnostic('bench baseline list'),
        update: createCommandReturningDiagnostic('bench baseline update')
    };
});

const benchmarkCommandsFactory = createFactory<CommandLineBenchmarkCommands>(function createBenchmarkCommands() {
    return {
        calibrate: createCommandReturningDiagnostic('bench calibrate'),
        baseline: benchmarkBaselineCommandsFactory,
        listBenchmarks: createCommandReturningDiagnostic('bench list'),
        runBenchmarks: createCommandReturningDiagnostic('bench run')
    };
});

export const testNode = suite('source/run/command-line-command-namespace.test.ts', [
    test('command namespace loads only selected command families', async function (scope: OverkillScope) {
        const loaders = {
            async loadConfig() {
                throw new Error('Unexpected history config loading.');
            },
            async loadReplayCommands() {
                throw new Error('Replay commands are not configured.');
            },
            loadBaselineCommands: testDouble.resolves<LoadBaselineCommands>(baselineCommandsFactory.build()),
            loadBenchmarkCommands: testDouble.resolves<LoadBenchmarkCommands>(benchmarkCommandsFactory.build())
        };
        const commands = createCommandLineCommandNamespace(loaders);
        const baseline = await commands.baseline.update({
            ...commandLineCommandContextFactory.build(),
            runRequest: defaultRunRequest()
        });
        const benchmark = await commands.bench.listBenchmarks({
            configPath: null,
            cwd: '/project',
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

        scope.assert(doubleUsage.callCount, loaders.loadBaselineCommands, 1);
        scope.assert(doubleUsage.callCount, loaders.loadBenchmarkCommands, 1);
        scope.assert.deepEqual(baseline.fallbackDiagnostics, [ 'baseline update' ]);
        scope.assert.deepEqual(benchmark.fallbackDiagnostics, [ 'bench list' ]);

        return scope.assert.collect();
    }),
    test('command namespace routes every lazy command method', async function (scope: OverkillScope) {
        const loaders = {
            async loadConfig() {
                throw new Error('Unexpected history config loading.');
            },
            async loadReplayCommands() {
                throw new Error('Replay commands are not configured.');
            },
            loadBaselineCommands: testDouble.resolves<LoadBaselineCommands>(baselineCommandsFactory.build()),
            loadBenchmarkCommands: testDouble.resolves<LoadBenchmarkCommands>(benchmarkCommandsFactory.build())
        };
        const commands = createCommandLineCommandNamespace(loaders);
        const context = commandLineCommandContextFactory.build();
        const results = await Promise.all([
            commands.baseline.apply({ ...context, runRequest: defaultRunRequest() }),
            commands.baseline.bootstrap({ ...context, runRequest: defaultRunRequest() }),
            commands.baseline.diff({ ...context, runRequest: defaultRunRequest() }),
            commands.baseline.list({ ...context, listRequest: { paths: [], profile: 'microtest' } }),
            commands.baseline.update({ ...context, runRequest: defaultRunRequest() }),
            commands.bench.baseline.apply({
                ...context,
                runRequest: { ...defaultRunRequest(), profile: null }
            }),
            commands.bench.baseline.bootstrap({
                ...context,
                runRequest: { ...defaultRunRequest(), profile: null }
            }),
            commands.bench.baseline.diff({ ...context, runRequest: { ...defaultRunRequest(), profile: null } }),
            commands.bench.baseline.list({
                ...context,
                listRequest: {
                    paths: [],
                    profile: null
                }
            }),
            commands.bench.baseline.update({
                ...context,
                runRequest: { ...defaultRunRequest(), profile: null }
            }),
            commands.bench.listBenchmarks({
                configPath: null,
                cwd: '/project',
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
            }),
            commands.bench.runBenchmarks({
                configPath: null,
                cwd: '/project',
                runRequest: { ...defaultRunRequest(), profile: null }
            })
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
    })
]);
