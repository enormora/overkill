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

export type CommandLineRunner = {
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
    readonly listTests: CommandLineCommand;
    readonly replayRun: CommandLineCommand;
    readonly replayWitness: CommandLineCommand;
    readonly runTests: (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>;
};

export type CommandLineRunnerDependencies = {
    readonly createDefaultReporter: () => Promise<Reporter>;
    readonly loadBaselineCommands: () => Promise<CommandLineBaselineCommands>;
    readonly loadBenchmarkCommands: () => Promise<CommandLineBenchmarkCommands>;
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

async function commandLineReporters(
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<readonly Reporter[]> {
    if (loadedConfig.reporters !== null) {
        return loadedConfig.reporters;
    }

    return [ await dependencies.createDefaultReporter() ];
}

async function commandLineConfig(
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<RunConfig> {
    return {
        loader: loadedConfig.loader,
        reporters: await commandLineReporters(loadedConfig, dependencies),
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

async function commandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<RunCommand> {
    return {
        config: await commandLineConfig(loadedConfig, dependencies),
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
    const command = await commandFromRequest(request, loadedConfig, dependencies);
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

function unimplementedCommandResult(command: string, context: CommandLineCommandContext): CommandLineRunnerResult {
    const argumentSuffix = context.arguments.length === 0
        ? ''
        : ` with ${context.arguments.length.toString()} arguments`;

    return commandLineErrorResult(
        new RunResolutionError(
            `Command "${command}"${argumentSuffix} is not implemented yet.`,
            undefined,
            'unsupported-request'
        )
    );
}

function unimplementedCommand(command: string): CommandLineCommand {
    return async function runUnimplementedCommand(context) {
        return unimplementedCommandResult(command, context);
    };
}

function createUnimplementedBaselineCommands(namespace: string): CommandLineBaselineCommands {
    return {
        apply: unimplementedCommand(`${namespace} apply`),
        bootstrap: unimplementedCommand(`${namespace} bootstrap`),
        diff: unimplementedCommand(`${namespace} diff`),
        list: unimplementedCommand(`${namespace} list`),
        update: unimplementedCommand(`${namespace} update`)
    };
}

async function loadUnimplementedBaselineCommands(): Promise<CommandLineBaselineCommands> {
    return createUnimplementedBaselineCommands('baseline');
}

async function loadUnimplementedBenchmarkCommands(): Promise<CommandLineBenchmarkCommands> {
    return {
        baseline: createUnimplementedBaselineCommands('bench baseline'),
        listBenchmarks: unimplementedCommand('bench list'),
        runBenchmarks: unimplementedCommand('bench run')
    };
}

export function createCommandLineRunner(dependencies: CommandLineRunnerDependencies): CommandLineRunner {
    return {
        baseline: {
            async apply(context) {
                const commands = await dependencies.loadBaselineCommands();
                return await commands.apply(context);
            },
            async bootstrap(context) {
                const commands = await dependencies.loadBaselineCommands();
                return await commands.bootstrap(context);
            },
            async diff(context) {
                const commands = await dependencies.loadBaselineCommands();
                return await commands.diff(context);
            },
            async list(context) {
                const commands = await dependencies.loadBaselineCommands();
                return await commands.list(context);
            },
            async update(context) {
                const commands = await dependencies.loadBaselineCommands();
                return await commands.update(context);
            }
        },
        bench: {
            baseline: {
                async apply(context) {
                    const commands = await dependencies.loadBenchmarkCommands();
                    return await commands.baseline.apply(context);
                },
                async bootstrap(context) {
                    const commands = await dependencies.loadBenchmarkCommands();
                    return await commands.baseline.bootstrap(context);
                },
                async diff(context) {
                    const commands = await dependencies.loadBenchmarkCommands();
                    return await commands.baseline.diff(context);
                },
                async list(context) {
                    const commands = await dependencies.loadBenchmarkCommands();
                    return await commands.baseline.list(context);
                },
                async update(context) {
                    const commands = await dependencies.loadBenchmarkCommands();
                    return await commands.baseline.update(context);
                }
            },
            async listBenchmarks(context) {
                const commands = await dependencies.loadBenchmarkCommands();
                return await commands.listBenchmarks(context);
            },
            async runBenchmarks(context) {
                const commands = await dependencies.loadBenchmarkCommands();
                return await commands.runBenchmarks(context);
            }
        },
        listTests: unimplementedCommand('list'),
        replayRun: unimplementedCommand('replay'),
        replayWitness: unimplementedCommand('replay-witness'),
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

async function loadDefaultLineReporter(): Promise<Reporter> {
    const reporterModule = await import('../packages/reporter-line/reporter-line.entry-point.ts');

    return reporterModule.createLineReporter();
}

export const commandLineRunner: CommandLineRunner = createCommandLineRunner({
    createDefaultReporter: loadDefaultLineReporter,
    loadBaselineCommands: loadUnimplementedBaselineCommands,
    loadBenchmarkCommands: loadUnimplementedBenchmarkCommands,
    loadRunConfig,
    orchestrator
});
