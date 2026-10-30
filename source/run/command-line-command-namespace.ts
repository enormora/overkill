import type { ConfigLoader } from '../config/config.ts';
import type {
    HistoryCommands,
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineCommand,
    CommandLineRunnerResult
} from './command-line-command.ts';

export type CommandLineCommandLoaders = {
    readonly loadConfig: ConfigLoader;
    readonly loadBaselineCommands: () => Promise<CommandLineBaselineCommands>;
    readonly loadBenchmarkCommands: () => Promise<CommandLineBenchmarkCommands>;
};

export type CommandLineCommandNamespace = {
    readonly history: HistoryCommands;
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
};

type SelectBaselineCommand = (commands: CommandLineBaselineCommands) => CommandLineCommand;
type BenchmarkCommand<Request> = (request: Request) => Promise<CommandLineRunnerResult>;
type SelectBenchmarkCommand<Request> = (commands: CommandLineBenchmarkCommands) => BenchmarkCommand<Request>;

function routeBaselineCommand(
    loadBaselineCommands: CommandLineCommandLoaders['loadBaselineCommands'],
    selectCommand: SelectBaselineCommand
): CommandLineCommand {
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
        history: createHistoryRoutes(loaders.loadConfig),
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
