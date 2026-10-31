import { realpath } from 'node:fs/promises';
import type { ConfigLoader } from '../config/config.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineCommand
} from './command-line-command.ts';
import { createHistory } from './history.ts';
import type { HistoryRunSummary } from './history-types.ts';
import { RunResolutionError } from './run-errors.ts';

type ReplayCommandDependencies = {
    readonly loadConfig: ConfigLoader;
    readonly isTerminal: () => boolean;
    readonly pickRun: (runs: readonly HistoryRunSummary[]) => Promise<string | null>;
    readonly replayRecordedRun: CommandLineCommand;
};

function argumentError(message: string): RunResolutionError {
    return new RunResolutionError(message, undefined, 'invalid-request');
}

export const replayTerminal = {
    isTerminal() {
        return process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY;
    },
    async pickRun(runs: readonly HistoryRunSummary[]): Promise<string | null> {
        const { pickReplayRun } = await import('./replay-terminal.ts');
        return await pickReplayRun(runs);
    }
};

async function selectRun(
    dependencies: ReplayCommandDependencies,
    context: Parameters<CommandLineCommand>[0]
): Promise<string | null> {
    if (!dependencies.isTerminal()) {
        throw argumentError(
            'Replay without a run id requires a terminal. Use overkill history list, then overkill replay <run-id>.'
        );
    }
    const config = await dependencies.loadConfig(context);
    const projectRoot = await realpath(context.cwd);
    const summaries = await createHistory({ projectRoot, config }).list();
    const runs = summaries.filter(function replayable(run) {
        return run.replay === 'available' || run.replay === 'available-interrupted';
    });
    if (runs.length === 0) {
        throw argumentError('No replayable retained records. Use overkill history list.');
    }
    return await dependencies.pickRun(runs);
}

async function executeReplay(
    dependencies: ReplayCommandDependencies,
    context: Parameters<CommandLineCommand>[0]
): ReturnType<CommandLineCommand> {
    if (context.arguments.length > 1) {
        throw argumentError('Replay accepts at most one run id.');
    }
    if (context.arguments.length === 1) {
        return await dependencies.replayRecordedRun(context);
    }
    const id = await selectRun(dependencies, context);
    return id === null
        ? { exitCode: 0, runResult: null, stdoutLines: [], fallbackDiagnostics: [] }
        : await dependencies.replayRecordedRun({ ...context, arguments: [ id ] });
}

export function createReplayCommand(dependencies: ReplayCommandDependencies): CommandLineCommand {
    return async function replay(context) {
        try {
            return await executeReplay(dependencies, context);
        } catch (error: unknown) {
            return createCommandLineErrorResultFromUnknown(error);
        }
    };
}
