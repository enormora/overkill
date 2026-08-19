import type { Reporter, SinkDeclaration } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunCommand, RunConfig, RunOrchestrator } from './run.ts';
import { orchestrator } from './run-orchestrator.ts';
import {
    loadRunConfig,
    type LoadedRunConfig,
    type RunConfigLoadRequest
} from './run-config.ts';
import {
    createCommandLineErrorResultFromUnknown,
    formatFallbackDiagnostics,
    readExitCodeFromRunResult,
    type CommandLineBaselineCommands,
    type CommandLineBenchmarkCommands,
    type CommandLineCommand,
    type CommandLineRunTestsRequest,
    type CommandLineRunnerResult as CommandLineRunnerResultShape
} from './command-line-command.ts';
import {
    createCommandLineCommandNamespace,
    type CommandLineCommandLoaders
} from './command-line-command-namespace.ts';
import {
    createUnimplementedCommand,
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from './command-line-unimplemented-commands.ts';

export type CommandLineRunner = {
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
    readonly listTests: CommandLineCommand;
    readonly replayRun: CommandLineCommand;
    readonly replayWitness: CommandLineCommand;
    readonly runTests: (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>;
};

export type CommandLineRunnerResult = CommandLineRunnerResultShape;

export type CommandLineRunnerDependencies = CommandLineCommandLoaders & {
    readonly createDefaultReporter: () => Promise<Reporter>;
    readonly loadRunConfig: (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>;
    readonly orchestrator: RunOrchestrator;
};

function hasTerminalSink(sink: SinkDeclaration): boolean {
    return sink.kind.startsWith('stdout') || sink.kind.startsWith('stderr');
}

function hasTerminalReporter(reporters: readonly Reporter[]): boolean {
    return reporters.some(function reporterClaimsTerminal(reporter) {
        return reporter.sinks.some(hasTerminalSink);
    });
}

function readFallbackDiagnostics(result: RunResult, reporters: readonly Reporter[]): readonly string[] {
    return formatFallbackDiagnostics(result, hasTerminalReporter(reporters));
}

async function loadCommandLineReporters(
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<readonly Reporter[]> {
    if (loadedConfig.reporters !== null) {
        return loadedConfig.reporters;
    }

    return [ await dependencies.createDefaultReporter() ];
}

async function createCommandLineConfig(
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<RunConfig> {
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters: await loadCommandLineReporters(loadedConfig, dependencies),
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

async function createCommandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<RunCommand> {
    return {
        config: await createCommandLineConfig(loadedConfig, dependencies),
        cwd: request.cwd,
        engine: null,
        request: request.request
    };
}

async function runTestsWithLoadedConfig(
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedRunConfig
): Promise<CommandLineRunnerResult> {
    const command = await createCommandFromRequest(request, loadedConfig, dependencies);
    const runResult = await dependencies.orchestrator.run(command);

    return {
        exitCode: readExitCodeFromRunResult(runResult),
        fallbackDiagnostics: readFallbackDiagnostics(runResult, command.config.reporters),
        runResult
    };
}

export function createCommandLineRunner(dependencies: CommandLineRunnerDependencies): CommandLineRunner {
    const commandNamespace = createCommandLineCommandNamespace(dependencies);

    return {
        baseline: commandNamespace.baseline,
        bench: commandNamespace.bench,
        listTests: createUnimplementedCommand('list'),
        replayRun: createUnimplementedCommand('replay'),
        replayWitness: createUnimplementedCommand('replay-witness'),
        async runTests(request) {
            try {
                const loadedConfig = await dependencies.loadRunConfig(request);
                return await runTestsWithLoadedConfig(request, dependencies, loadedConfig);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
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
