import type {
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineCommand
} from './command-line-command.ts';

export type CommandLineCommandLoaders = {
    readonly loadBaselineCommands: () => Promise<CommandLineBaselineCommands>;
    readonly loadBenchmarkCommands: () => Promise<CommandLineBenchmarkCommands>;
};

export type CommandLineCommandNamespace = {
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
};

type SelectBaselineCommand = (commands: CommandLineBaselineCommands) => CommandLineCommand;
type SelectBenchmarkCommand = (commands: CommandLineBenchmarkCommands) => CommandLineCommand;

function routeBaselineCommand(
    loadBaselineCommands: CommandLineCommandLoaders['loadBaselineCommands'],
    selectCommand: SelectBaselineCommand
): CommandLineCommand {
    return async function runBaselineCommandRoute(context) {
        const commands = await loadBaselineCommands();

        return await selectCommand(commands)(context);
    };
}

function routeBenchmarkCommand(
    loadBenchmarkCommands: CommandLineCommandLoaders['loadBenchmarkCommands'],
    selectCommand: SelectBenchmarkCommand
): CommandLineCommand {
    return async function runBenchmarkCommandRoute(context) {
        const commands = await loadBenchmarkCommands();

        return await selectCommand(commands)(context);
    };
}

export function createCommandLineCommandNamespace(loaders: CommandLineCommandLoaders): CommandLineCommandNamespace {
    return {
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
