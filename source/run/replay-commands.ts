import type { ConfigLoader } from '../config/config-loader.ts';
import { parseReplayDebugArguments } from './replay-debug-arguments.ts';
import type { ReplayOperations } from './replay-types.ts';
import { createDefaultDirectReporter } from './default-direct-reporter.ts';
import {
    createCommandLineErrorResultFromUnknown,
    readExitCodeFromRunResult,
    formatRunnerErrorDiagnostics,
    type CommandLineCommand,
    type CommandLineCommandContext
} from './command-line-command.ts';
import { RunResolutionError } from './run-errors.ts';

export type ReplayCommands = {
    readonly replayRun: CommandLineCommand;
    readonly replayWitness: CommandLineCommand;
};
type ReplayKind = 'record' | 'witness';
type ReplayOperands = { readonly target: string; readonly profile: string; };
const witnessOperandCount = 2;
function operands(context: CommandLineCommandContext, kind: ReplayKind): ReplayOperands {
    const [ target, profile ] = context.arguments;
    const expected = kind === 'record' ? 1 : witnessOperandCount;
    if (target === undefined || context.arguments.length !== expected) {
        throw new RunResolutionError(
            kind === 'record'
                ? 'Replay requires one retained run id.'
                : 'Witness replay requires a path and --profile.',
            { cause: null },
            'invalid-request'
        );
    }
    return { target, profile: profile ?? '' };
}
async function deliverReplay(
    context: CommandLineCommandContext,
    kind: ReplayKind,
    loadConfig: ConfigLoader,
    operations: ReplayOperations
): ReturnType<CommandLineCommand> {
    const parsed = parseReplayDebugArguments(context.arguments);
    const { target, profile } = operands({ ...context, arguments: parsed.operands }, kind);
    const loaded = await loadConfig(context);
    const config = { ...loaded, reporters: loaded.reporters ?? [ await createDefaultDirectReporter() ] };
    const input = { debug: parsed.debug, cwd: context.cwd, config, signal: null };
    const delivery = kind === 'record'
        ? await operations.replayWithReporterDelivery({ ...input, runId: target })
        : await operations.replayWitnessWithReporterDelivery({ ...input, path: target, profile });
    return {
        exitCode: readExitCodeFromRunResult(delivery.result),
        fallbackDiagnostics: [
            ...formatRunnerErrorDiagnostics(delivery.undeliveredRunnerErrors),
            ...delivery.result.maintenanceDiagnostics
        ],
        runResult: delivery.result,
        stdoutLines: []
    };
}
export function createReplayCommands(loadConfig: ConfigLoader, operations: ReplayOperations): ReplayCommands {
    async function execute(context: CommandLineCommandContext, kind: ReplayKind): ReturnType<CommandLineCommand> {
        try {
            return await deliverReplay(context, kind, loadConfig, operations);
        } catch (error: unknown) {
            return createCommandLineErrorResultFromUnknown(error);
        }
    }
    return {
        async replayRun(context) {
            return await execute(context, 'record');
        },
        async replayWitness(context) {
            return await execute(context, 'witness');
        }
    };
}
