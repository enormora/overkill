import { createLineReporter } from '@overkill-dev/reporter-line';
import type { Reporter, SinkDeclaration } from '../engine/reporter.ts';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    orchestrator,
    RunResolutionError,
    type RunCommand,
    type RunConfig,
    type RunOrchestrator,
    type RunRequest
} from './run.ts';
import {
    loadRunConfig,
    RunConfigError,
    type LoadedRunConfig,
    type RunConfigLoadRequest
} from './run-config.ts';

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
    readonly testPlan: TestPlan;
};

export type CommandLineRunnerResult = {
    readonly exitCode: CommandLineExitCode;
    readonly fallbackDiagnostics: readonly string[];
    readonly runResult: RunResult | null;
};

export type CommandLineRunner = {
    readonly runTests: (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>;
};

export type CommandLineRunnerDependencies = {
    readonly createDefaultReporter: () => Reporter;
    readonly loadRunConfig: (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>;
    readonly orchestrator: RunOrchestrator;
};

function hasTerminalSink(sink: SinkDeclaration): boolean {
    return sink.kind === 'stdout' || sink.kind === 'stderr';
}

function hasTerminalReporter(reporters: readonly Reporter[]): boolean {
    return reporters.some(function reporterClaimsTerminal(reporter) {
        return reporter.sinks.some(hasTerminalSink);
    });
}

function formatRunnerError(error: RunnerError): string {
    return `Overkill runner error: ${error.message}`;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function fallbackDiagnostics(result: RunResult, reporters: readonly Reporter[]): readonly string[] {
    const reporterErrors = result.runnerErrors.filter(function isReporterError(error) {
        return error.subtype === 'reporter';
    });
    const unreportedErrors = hasTerminalReporter(reporters) ? reporterErrors : result.runnerErrors;

    return unreportedErrors.map(formatRunnerError);
}

function exitCodeFromRunResult(result: RunResult): CommandLineExitCode {
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

function commandLineConfig(loadedConfig: LoadedRunConfig, dependencies: CommandLineRunnerDependencies): RunConfig {
    return {
        loader: loadedConfig.loader,
        reporters: loadedConfig.reporters ?? [ dependencies.createDefaultReporter() ],
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

function commandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): RunCommand {
    return {
        config: commandLineConfig(loadedConfig, dependencies),
        request: request.request,
        testPlan: request.testPlan
    };
}

function errorResult(exitCode: CommandLineExitCode, label: string, error: unknown): CommandLineRunnerResult {
    return {
        exitCode,
        fallbackDiagnostics: [ `Overkill ${label}: ${formatError(error)}` ],
        runResult: null
    };
}

async function runTestsWithLoadedConfig(
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedRunConfig
): Promise<CommandLineRunnerResult> {
    const command = commandFromRequest(request, loadedConfig, dependencies);
    const runResult = await dependencies.orchestrator.run(command);

    return {
        exitCode: exitCodeFromRunResult(runResult),
        fallbackDiagnostics: fallbackDiagnostics(runResult, command.config.reporters),
        runResult
    };
}

function commandLineErrorResult(error: unknown): CommandLineRunnerResult {
    if (error instanceof RunConfigError) {
        return errorResult(commandLineExitCodes.argumentOrConfig, 'configuration error', error);
    }

    if (error instanceof RunResolutionError) {
        return errorResult(commandLineExitCodes.argumentOrConfig, 'argument error', error);
    }

    if (error instanceof TypeError && error.message.startsWith('Reporter sink conflict:')) {
        return errorResult(commandLineExitCodes.argumentOrConfig, 'configuration error', error);
    }

    return errorResult(commandLineExitCodes.internalCrash, 'internal error', error);
}

export function createCommandLineRunner(dependencies: CommandLineRunnerDependencies): CommandLineRunner {
    return {
        async runTests(request) {
            try {
                const loadedConfig = await dependencies.loadRunConfig(request);
                return await runTestsWithLoadedConfig(request, dependencies, loadedConfig);
            } catch (error: unknown) {
                return commandLineErrorResult(error);
            }
        }
    };
}

export const commandLineRunner: CommandLineRunner = createCommandLineRunner({
    createDefaultReporter: createLineReporter,
    loadRunConfig,
    orchestrator
});
