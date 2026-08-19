import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { ReporterSinkConflictError } from '../engine/reporter.ts';
import type { RunRequest } from './run-types.ts';
import { RunResolutionError } from './run-errors.ts';
import { RunConfigError, type RunConfigLoadRequest } from './run-config.ts';

export const commandLineExitCodes = Object.freeze({
    argumentOrConfig: 3,
    internalCrash: 70,
    noTestsCollected: 4,
    pass: 0,
    resourceExhaustion: 5,
    runnerError: 2,
    testFailure: 1
});

export type CommandLineExitCode = (typeof commandLineExitCodes)[keyof typeof commandLineExitCodes];

export type CommandLineRunTestsRequest = RunConfigLoadRequest & {
    readonly request: RunRequest;
};

export type CommandLineCommandContext = RunConfigLoadRequest & {
    readonly arguments: readonly string[];
};

export type CommandLineRunnerResult = {
    readonly exitCode: CommandLineExitCode;
    readonly fallbackDiagnostics: readonly string[];
    readonly runResult: RunResult | null;
};

export type CommandLineCommand = (context: CommandLineCommandContext) => Promise<CommandLineRunnerResult>;

export type CommandLineBaselineCommands = {
    readonly apply: CommandLineCommand;
    readonly bootstrap: CommandLineCommand;
    readonly diff: CommandLineCommand;
    readonly list: CommandLineCommand;
    readonly update: CommandLineCommand;
};

export type CommandLineBenchmarkCommands = {
    readonly baseline: CommandLineBaselineCommands;
    readonly listBenchmarks: CommandLineCommand;
    readonly runBenchmarks: CommandLineCommand;
};

function formatRunnerError(error: RunnerError): string {
    return `Overkill runner error: ${error.message}`;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function isInspectableObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isRunnerError(value: unknown): value is RunnerError {
    return isInspectableObject(value) &&
        Object.hasOwn(value, 'message') &&
        Object.hasOwn(value, 'subtype') &&
        typeof value.message === 'string' &&
        typeof value.subtype === 'string';
}

function aggregateEntries(error: AggregateError): readonly unknown[] {
    return Array.isArray(error.errors) ? error.errors : [];
}

function primaryError(error: unknown): unknown {
    if (!(error instanceof AggregateError)) {
        return error;
    }

    return error.cause ?? aggregateEntries(error)[0] ?? error;
}

function formatSupplementalError(error: unknown): string {
    if (isRunnerError(error)) {
        return formatRunnerError(error);
    }

    return `Overkill internal error: ${formatError(error)}`;
}

function formatErrorDiagnostics(label: string, error: unknown): readonly string[] {
    const primary = primaryError(error);
    const diagnostics = [ `Overkill ${label}: ${formatError(primary)}` ];

    if (!(error instanceof AggregateError)) {
        return diagnostics;
    }

    let skippedPrimary = false;

    return [
        ...diagnostics,
        ...aggregateEntries(error).flatMap(function formatAggregateEntry(entry) {
            if (!skippedPrimary && entry === primary) {
                skippedPrimary = true;

                return [];
            }

            return [ formatSupplementalError(entry) ];
        })
    ];
}

export function formatFallbackDiagnostics(
    result: RunResult,
    reportersClaimTerminal: boolean
): readonly string[] {
    const reporterErrors = result.runnerErrors.filter(function isReporterError(error) {
        return error.subtype === 'reporter';
    });
    const unreportedErrors = reportersClaimTerminal ? reporterErrors : result.runnerErrors;

    return unreportedErrors.map(formatRunnerError);
}

export function readExitCodeFromRunResult(result: RunResult): CommandLineExitCode {
    if (result.runnerErrors.length > 0) {
        return commandLineExitCodes.runnerError;
    }

    if (result.summary.planned === 0) {
        return commandLineExitCodes.noTestsCollected;
    }

    if (result.summary.failed > 0) {
        return commandLineExitCodes.testFailure;
    }

    return commandLineExitCodes.pass;
}

function createCommandLineErrorResult(
    exitCode: CommandLineExitCode,
    label: string,
    error: unknown
): CommandLineRunnerResult {
    return {
        exitCode,
        fallbackDiagnostics: formatErrorDiagnostics(label, error),
        runResult: null
    };
}

export function createCommandLineErrorResultFromUnknown(error: unknown): CommandLineRunnerResult {
    const classifiedError = primaryError(error);

    if (classifiedError instanceof RunConfigError) {
        return createCommandLineErrorResult(commandLineExitCodes.argumentOrConfig, 'configuration error', error);
    }

    if (classifiedError instanceof ReporterSinkConflictError) {
        return createCommandLineErrorResult(commandLineExitCodes.argumentOrConfig, 'configuration error', error);
    }

    if (classifiedError instanceof RunResolutionError) {
        if (classifiedError.code() === 'no-tests-collected') {
            return createCommandLineErrorResult(commandLineExitCodes.noTestsCollected, 'no tests collected', error);
        }

        return createCommandLineErrorResult(commandLineExitCodes.argumentOrConfig, 'argument error', error);
    }

    return createCommandLineErrorResult(commandLineExitCodes.internalCrash, 'internal error', error);
}
