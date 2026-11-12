import type { ConfigLoader, ConfigLoadRequest } from '../config/config-loader.ts';
import {
    commandLineExitCodes,
    createCommandLineErrorResultFromUnknown,
    readExitCodeFromRunResult,
    formatRunnerErrorDiagnostics,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import { invalidRequest } from './run-errors.ts';
import { mergeResults } from './merge-results.ts';
import type { MergeResultsInput } from './merge-results-types.ts';

export type MergeResultsRequest = ConfigLoadRequest & { readonly paths: readonly string[]; };
async function executeMergeCommand(
    loadConfig: ConfigLoader,
    request: MergeResultsRequest
): Promise<CommandLineRunnerResult> {
    const [ first, ...remaining ] = request.paths;
    if (first === undefined) {
        return invalidRequest('Merge results requires at least one path.');
    }
    const config = await loadConfig(request);
    function classify(path: string): MergeResultsInput {
        return { kind: 'path', path };
    }
    const merged = await mergeResults({
        config,
        cwd: request.cwd,
        inputs: [ classify(first), ...remaining.map(classify) ]
    });
    const incomplete = merged.result.runnerErrors.some(function mergeError(error) {
        return error.subtype === 'merge';
    });
    return {
        exitCode: incomplete ? commandLineExitCodes.runnerError : readExitCodeFromRunResult(merged.result),
        fallbackDiagnostics: formatRunnerErrorDiagnostics(merged.result.runnerErrors),
        runResult: merged.result,
        stdoutLines: []
    };
}
export async function mergeResultsCommand(
    loadConfig: ConfigLoader,
    request: MergeResultsRequest
): Promise<CommandLineRunnerResult> {
    try {
        return await executeMergeCommand(loadConfig, request);
    } catch (error: unknown) {
        return createCommandLineErrorResultFromUnknown(error);
    }
}
