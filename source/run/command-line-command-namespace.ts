import type { ConfigLoader } from '../config/config.ts';
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

export type CommandLineCommandNamespace = {
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

async function loadHistoryCommands(loadConfig: ConfigLoader): Promise<HistoryCommands> {
    const { createHistoryCommands } = await import('./history-commands.ts');
    return createHistoryCommands(loadConfig);
}
function createHistoryRoutes(loadConfig: ConfigLoader): HistoryCommands {
    return {
        async list(request) {
            const commands = await loadHistoryCommands(loadConfig);
            return await commands.list(request);
        },
        async prune(request) {
            const commands = await loadHistoryCommands(loadConfig);
            return await commands.prune(request);
        },
        async compact(request) {
            const commands = await loadHistoryCommands(loadConfig);
            return await commands.compact(request);
        },
        async clear(request) {
            const commands = await loadHistoryCommands(loadConfig);
            return await commands.clear(request);
        }
    };
}

export function createCommandLineCommandNamespace(loaders: CommandLineCommandLoaders): CommandLineCommandNamespace {
    return {
        corpus: {
            async inspect(request) {
                const { corpusCommands } = await import('./corpus-commands.ts');
                return await corpusCommands.inspect(request);
            },
            async promote(request) {
                const { corpusCommands } = await import('./corpus-commands.ts');
                return await corpusCommands.promote(request);
            },
            async migrate(request) {
                const { corpusCommands } = await import('./corpus-commands.ts');
                return await corpusCommands.migrate(request);
            }
        },
        history: createHistoryRoutes(loaders.loadConfig),
        async replayRun(context) {
            const { createReplayCommand, replayTerminal } = await import('./replay-command.ts');
            const commands = await loaders.loadReplayCommands();
            return await createReplayCommand({
                loadConfig: loaders.loadConfig,
                isTerminal: replayTerminal.isTerminal,
                pickRun: replayTerminal.pickRun,
                replayRecordedRun: commands.replayRun
            })(context);
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
