import { RunResolutionError } from './run-errors.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineBaselineCommands,
    type CommandLineCommand,
    type CommandLineCommandContext,
    type CommandLineRunnerResult
} from './command-line-command.ts';

function createUnimplementedCommandResult(
    command: string,
    context: CommandLineCommandContext
): CommandLineRunnerResult {
    const argumentSuffix = context.arguments.length === 0
        ? ''
        : ` with ${context.arguments.length.toString()} arguments`;

    return createCommandLineErrorResultFromUnknown(
        new RunResolutionError(
            `Command "${command}"${argumentSuffix} is not implemented yet.`,
            undefined,
            'unsupported-request'
        )
    );
}

export function createUnimplementedCommand(command: string): CommandLineCommand {
    return async function runUnimplementedCommand(context) {
        return createUnimplementedCommandResult(command, context);
    };
}

export function createUnimplementedBaselineCommands(namespace: string): CommandLineBaselineCommands {
    return {
        apply: createUnimplementedCommand(`${namespace} apply`),
        bootstrap: createUnimplementedCommand(`${namespace} bootstrap`),
        diff: createUnimplementedCommand(`${namespace} diff`),
        list: createUnimplementedCommand(`${namespace} list`),
        update: createUnimplementedCommand(`${namespace} update`)
    };
}

export async function loadUnimplementedBaselineCommands(): Promise<CommandLineBaselineCommands> {
    return createUnimplementedBaselineCommands('baseline');
}
