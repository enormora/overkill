import type { ConfigLoader, ConfigLoadRequest } from '../config/config-loader.ts';
import {
    createCommandLineErrorResultFromUnknown,
    readExitCodeFromRunResult,
    formatRunnerErrorDiagnostics,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import { invalidRequest } from './run-errors.ts';
import { mergeResults } from './merge-results.ts';
import type { MergeResultsInput } from './merge-results-types.ts';
import { classifyMergeInput } from './merge-results-input.ts';

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
    async function classify(path: string): Promise<MergeResultsInput> {
        return await classifyMergeInput(request.cwd, path);
    }
    const merged = await mergeResults({
        config,
        cwd: request.cwd,
        inputs: [ await classify(first), ...await Promise.all(remaining.map(classify)) ]
    });
    return {
        exitCode: readExitCodeFromRunResult(merged.result),
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
