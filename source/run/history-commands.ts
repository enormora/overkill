import { realpath } from 'node:fs/promises';
import type { ConfigLoader } from '../config/config.ts';
import {
    createCommandLineErrorResultFromUnknown,
    type HistoryCommands,
    type HistoryCommandRequest,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import { createHistory } from './history.ts';
import type { History } from './history-types.ts';
import { confirmHistoryClear } from './history-confirmation.ts';

type HistoryOutput = Pick<CommandLineRunnerResult, 'fallbackDiagnostics' | 'stdoutLines'>;
type HistoryOperation = (history: History, request: HistoryCommandRequest) => Promise<HistoryOutput>;
const operations: Readonly<Record<keyof HistoryCommands, HistoryOperation>> = {
    async list(history) {
        const summaries = await history.list();
        return {
            fallbackDiagnostics: [],
            stdoutLines: [
                'ID\tSTARTED\tPROFILE\tFAMILY\tSTATUS\tDURATION (us)\tREPLAY',
                ...summaries.map(function summaryLine(value) {
                    return [
                        value.id,
                        value.startedAt,
                        value.profile,
                        value.testFamily,
                        value.status,
                        value.durationMicroseconds ?? '',
                        value.replay
                    ]
                        .join('\t');
                })
            ]
        };
    },
    async prune(history, request) {
        const result = await history.prune({ dryRun: request.dryRun });
        const action = request.dryRun ? 'Would remove' : 'Removed';
        return {
            fallbackDiagnostics: result.diagnostics,
            stdoutLines: [
                ...result.paths.map(function removalLine(value) {
                    return `${action} ${value}`;
                }),
                `${action} ${result.removedSummaries} summaries, ${result.removedCases} cases, ` +
                `${result.removedWorkEntries} work entries.`
            ]
        };
    },
    async compact(history) {
        const result = await history.compact();
        return {
            stdoutLines: [ `Compacted ${result.rebuiltRunCount} retained runs.` ],
            fallbackDiagnostics: result.diagnostics
        };
    },
    async clear(history, request) {
        if (!await confirmHistoryClear(request.yes)) {
            return { stdoutLines: [], fallbackDiagnostics: [] };
        }
        const result = await history.clear({ confirmed: true });
        return { stdoutLines: [ 'History cleared.' ], fallbackDiagnostics: result.diagnostics };
    }
};
async function executeHistoryCommand(
    loadConfig: ConfigLoader,
    verb: keyof HistoryCommands,
    request: HistoryCommandRequest
): Promise<CommandLineRunnerResult> {
    const config = await loadConfig(request);
    const projectRoot = await realpath(request.cwd);
    const history = createHistory({ projectRoot, config });
    const output = await operations[verb](history, request);
    return { exitCode: 0, runResult: null, ...output };
}
export function createHistoryCommands(loadConfig: ConfigLoader): HistoryCommands {
    function command(verb: keyof HistoryCommands): HistoryCommands['list'] {
        return async function runHistoryCommand(request) {
            try {
                return await executeHistoryCommand(loadConfig, verb, request);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        };
    }
    return { list: command('list'), prune: command('prune'), compact: command('compact'), clear: command('clear') };
}
