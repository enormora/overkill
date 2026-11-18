import type { ConfigLoader } from '../config/config-loader.ts';
import type { MergeResultsRequest } from './merge-results-command.ts';
import type { ReplayCommands } from './replay-commands.ts';
import type { CorpusCommands } from './corpus-commands.ts';
import type {
    HistoryCommands,
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineCommand,
    CommandLineRunnerResult
} from './command-line-command.ts';

export type CommandLineCommandLoaders = {
    readonly loadConfig: ConfigLoader;
    readonly loadReplayCommands: () => Promise<ReplayCommands>;
    readonly loadBaselineCommands: () => Promise<CommandLineBaselineCommands>;
    readonly loadBenchmarkCommands: () => Promise<CommandLineBenchmarkCommands>;
};

export type CommandLineNamespaceRuntime = {
    readonly history: (load: ConfigLoader) => Promise<HistoryCommands>;
    readonly corpus: () => Promise<CorpusCommands>;
    readonly merge: (load: ConfigLoader, request: MergeResultsRequest) => Promise<CommandLineRunnerResult>;
    readonly replay: (
        loaders: CommandLineCommandLoaders,
        context: Parameters<CommandLineCommand>[0]
    ) => Promise<CommandLineRunnerResult>;
};

export type CommandLineCommandNamespace = {
    readonly mergeResults: (request: MergeResultsRequest) => Promise<CommandLineRunnerResult>;

    readonly corpus: CorpusCommands;
    readonly history: HistoryCommands;
    readonly replayRun: CommandLineCommand;
    readonly replayWitness: CommandLineCommand;
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
};

type BaselineCommand<Request> = (request: Request) => Promise<CommandLineRunnerResult>;
type SelectBaselineCommand<Request> = (commands: CommandLineBaselineCommands) => BaselineCommand<Request>;
type BenchmarkCommand<Request> = (request: Request) => Promise<CommandLineRunnerResult>;
type SelectBenchmarkCommand<Request> = (commands: CommandLineBenchmarkCommands) => BenchmarkCommand<Request>;

function routeBaselineCommand<Request>(
    loadBaselineCommands: CommandLineCommandLoaders['loadBaselineCommands'],
    selectCommand: SelectBaselineCommand<Request>
): BaselineCommand<Request> {
    return async function runBaselineCommandRoute(context) {
        const commands = await loadBaselineCommands();

        return await selectCommand(commands)(context);
    };
}

function routeBenchmarkCommand<Request>(
    loadBenchmarkCommands: CommandLineCommandLoaders['loadBenchmarkCommands'],
    selectCommand: SelectBenchmarkCommand<Request>
): BenchmarkCommand<Request> {
    return async function runBenchmarkCommandRoute(context) {
        const commands = await loadBenchmarkCommands();

        return await selectCommand(commands)(context);
    };
}

function createHistoryRoutes(loadConfig: ConfigLoader, runtime: CommandLineNamespaceRuntime): HistoryCommands {
    return {
        async list(request) {
            const commands = await runtime.history(loadConfig);
            return await commands.list(request);
        },
        async prune(request) {
            const commands = await runtime.history(loadConfig);
            return await commands.prune(request);
        },
        async compact(request) {
            const commands = await runtime.history(loadConfig);
            return await commands.compact(request);
        },
        async clear(request) {
            const commands = await runtime.history(loadConfig);
            return await commands.clear(request);
        }
    };
}

export function createCommandLineRoutes(
    loaders: CommandLineCommandLoaders,
    runtime: CommandLineNamespaceRuntime
): CommandLineCommandNamespace {
    return {
        async mergeResults(request) {
            return await runtime.merge(loaders.loadConfig, request);
        },
        corpus: {
            async inspect(request) {
                const commands = await runtime.corpus();
                return await commands.inspect(request);
            },
            async promote(request) {
                const commands = await runtime.corpus();
                return await commands.promote(request);
            },
            async migrate(request) {
                const commands = await runtime.corpus();
                return await commands.migrate(request);
            }
        },
        history: createHistoryRoutes(loaders.loadConfig, runtime),
        async replayRun(context) {
            return await runtime.replay(loaders, context);
        },
        async replayWitness(context) {
            const commands = await loaders.loadReplayCommands();
            return await commands.replayWitness(context);
        },
        baseline: {
            apply: routeBaselineCommand(loaders.loadBaselineCommands, function selectApplyCommand(commands) {
                return commands.apply;
            }),
            bootstrap: routeBaselineCommand(loaders.loadBaselineCommands, function selectBootstrapCommand(commands) {
                return commands.bootstrap;
            }),
            diff: routeBaselineCommand(loaders.loadBaselineCommands, function selectDiffCommand(commands) {
                return commands.diff;
            }),
            list: routeBaselineCommand(loaders.loadBaselineCommands, function selectListCommand(commands) {
                return commands.list;
            }),
            update: routeBaselineCommand(loaders.loadBaselineCommands, function selectUpdateCommand(commands) {
                return commands.update;
            })
        },
        bench: {
            calibrate: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectCalibrateCommand(commands) {
                return commands.calibrate;
            }),
            baseline: {
                apply: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectApplyCommand(commands) {
                    return commands.baseline.apply;
                }),
                bootstrap: routeBenchmarkCommand(
                    loaders.loadBenchmarkCommands,
                    function selectBootstrapCommand(commands) {
                        return commands.baseline.bootstrap;
                    }
                ),
                diff: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectDiffCommand(commands) {
                    return commands.baseline.diff;
                }),
                list: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectListCommand(commands) {
                    return commands.baseline.list;
                }),
                update: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectUpdateCommand(commands) {
                    return commands.baseline.update;
                })
            },
            listBenchmarks: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectListCommand(commands) {
                return commands.listBenchmarks;
            }),
            runBenchmarks: routeBenchmarkCommand(loaders.loadBenchmarkCommands, function selectRunCommand(commands) {
                return commands.runBenchmarks;
            })
        }
    };
}
