import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { ReporterSinkConflictError } from '../engine/reporter.ts';
import type { RunRequest } from './run-types.ts';
import { RunCollectionError, RunResolutionError } from './run-errors.ts';
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
    readonly runRequest: RunRequest;
};

export type CommandLineListTestsRequest = RunConfigLoadRequest & {
    readonly listRequest: {
        readonly paths: readonly string[];
        readonly profile: string;
        readonly withOrphans: boolean;
    };
};

export type CommandLineCommandContext = RunConfigLoadRequest & {
    readonly arguments: readonly string[];
};

export type CommandLineRunnerResult = {
    readonly exitCode: CommandLineExitCode;
    readonly fallbackDiagnostics: readonly string[];
    readonly runResult: RunResult | null;
    readonly stdoutLines: readonly string[];
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

export function formatRunnerErrorDiagnostics(errors: readonly RunnerError[]): readonly string[] {
    return errors.map(formatRunnerError);
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
    deliveredRunnerErrors: ReadonlySet<RunnerError>
): readonly string[] {
    const unreportedErrors = result.runnerErrors.filter(function wasNotDelivered(error) {
        return !deliveredRunnerErrors.has(error);
    });

    return formatRunnerErrorDiagnostics(unreportedErrors);
}

export function readExitCodeFromRunResult(result: RunResult): CommandLineExitCode {
    const hasResourceExhaustion = result.runnerErrors.some(function isResourceExhaustion(error) {
        return error.subtype === 'resource-exhaustion';
    });

    if (hasResourceExhaustion || result.summary.resourceExhausted > 0) {
        return commandLineExitCodes.resourceExhaustion;
    }

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
        runResult: null,
        stdoutLines: []
    };
}

function createCommandLineResolutionErrorResult(
    classifiedError: RunResolutionError,
    error: unknown
): CommandLineRunnerResult {
    if (classifiedError.code() === 'no-tests-collected') {
        return createCommandLineErrorResult(commandLineExitCodes.noTestsCollected, 'no tests collected', error);
    }

    return createCommandLineErrorResult(commandLineExitCodes.argumentOrConfig, 'argument error', error);
}

function createCommandLineCollectionErrorResult(error: RunCollectionError): CommandLineRunnerResult {
    return {
        exitCode: commandLineExitCodes.runnerError,
        fallbackDiagnostics: formatRunnerErrorDiagnostics([ error.runnerError() ]),
        runResult: null,
        stdoutLines: []
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
        return createCommandLineResolutionErrorResult(classifiedError, error);
    }

    if (classifiedError instanceof RunCollectionError) {
        return createCommandLineCollectionErrorResult(classifiedError);
    }

    return createCommandLineErrorResult(commandLineExitCodes.internalCrash, 'internal error', error);
}
