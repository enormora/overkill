import type { Except } from 'type-fest';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { ReporterSinkConflictError } from '../engine/reporter.ts';
import { ConfigError } from '../config/config-error.ts';
import type { ConfigLoadRequest } from '../config/config.ts';
import type { ProfileRunRequest, RunRequest } from './run-types.ts';
import { RunCollectionError, RunResolutionError } from './run-errors.ts';

type CommandLineRunOrder = Exclude<RunRequest['order'], 'plan'>;

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

type ExitCodeRule = {
    readonly exitCode: CommandLineExitCode;
    readonly matches: (result: RunResult) => boolean;
};

export type CommandLineRunTestsRequest = ConfigLoadRequest & {
    readonly runRequest: RunRequest;
};

type CommandLineListRequest<Profile extends string | null> = {
    readonly order: CommandLineRunOrder;
    readonly paths: readonly string[];
    readonly profile: Profile;
    readonly seed: RunRequest['seed'];
    readonly selection: RunRequest['selection'];
    readonly shard: RunRequest['shard'];
    readonly withLocations: boolean;
    readonly withOrphans: boolean;
};

export type CommandLineListTestsRequest = ConfigLoadRequest & {
    readonly listRequest: CommandLineListRequest<string>;
};

export type CommandLineCommandContext = ConfigLoadRequest & {
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

export type BenchmarkRunRequest = ProfileRunRequest<string | null>;

export type CommandLineBenchmarkRunRequest = ConfigLoadRequest & {
    readonly runRequest: BenchmarkRunRequest;
};

export type CommandLineBenchmarkListRequest = ConfigLoadRequest & {
    readonly listRequest: CommandLineListRequest<string | null>;
};

export type CommandLineBenchmarkCommands = {
    readonly baseline: CommandLineBenchmarkBaselineCommands;
    readonly listBenchmarks: (request: CommandLineBenchmarkListRequest) => Promise<CommandLineRunnerResult>;
    readonly runBenchmarks: (request: CommandLineBenchmarkRunRequest) => Promise<CommandLineRunnerResult>;
};

export type CommandLineBenchmarkBaselineRequest = ConfigLoadRequest & {
    readonly runRequest: Except<BenchmarkRunRequest, 'baselineUpdateMode'>;
};

export type CommandLineBenchmarkBaselineListRequest = ConfigLoadRequest & {
    readonly listRequest: { readonly paths: readonly string[]; readonly profile: string | null; };
};

export type CommandLineBenchmarkBaselineCommands = {
    readonly apply: (request: CommandLineBenchmarkBaselineRequest) => Promise<CommandLineRunnerResult>;
    readonly bootstrap: (request: CommandLineBenchmarkBaselineRequest) => Promise<CommandLineRunnerResult>;
    readonly diff: (request: CommandLineBenchmarkBaselineRequest) => Promise<CommandLineRunnerResult>;
    readonly list: (request: CommandLineBenchmarkBaselineListRequest) => Promise<CommandLineRunnerResult>;
    readonly update: (request: CommandLineBenchmarkBaselineRequest) => Promise<CommandLineRunnerResult>;
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

function hasResourceExhaustion(result: RunResult): boolean {
    return result.runnerErrors.some(function isResourceExhaustion(error) {
        return error.subtype === 'resource-exhaustion';
    });
}

const exitCodeRules: readonly ExitCodeRule[] = [
    {
        exitCode: commandLineExitCodes.resourceExhaustion,
        matches(result) {
            return hasResourceExhaustion(result) || result.summary.resourceExhausted > 0;
        }
    },
    {
        exitCode: commandLineExitCodes.runnerError,
        matches(result) {
            return result.runnerErrors.length > 0;
        }
    },
    {
        exitCode: commandLineExitCodes.noTestsCollected,
        matches(result) {
            return result.planStatus === 'empty-selection';
        }
    },
    {
        exitCode: commandLineExitCodes.testFailure,
        matches(result) {
            return result.summary.failed > 0;
        }
    },
    {
        exitCode: commandLineExitCodes.runnerError,
        matches(result) {
            return result.status === 'failed';
        }
    }
];

export function readExitCodeFromRunResult(result: RunResult): CommandLineExitCode {
    return exitCodeRules
        .find(function findMatchingRule(rule) {
            return rule.matches(result);
        })
        ?.exitCode ?? commandLineExitCodes.pass;
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

    if (classifiedError instanceof ConfigError) {
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
