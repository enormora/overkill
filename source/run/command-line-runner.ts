import type { Reporter, SinkDeclaration } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunCommand, RunConfig, RunOrchestrator } from './run-types.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
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
import {
    resolveCommandReporters,
    selectCommandLineReporterFallback,
    type CommandLineReporterFallback
} from './run-reporter-resolution.ts';

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

async function loadCommandLineReporterFallback(
    fallback: CommandLineReporterFallback,
    dependencies: CommandLineRunnerDependencies
): Promise<readonly Reporter[]> {
    if (fallback.kind === 'configured') {
        return fallback.reporters;
    }

    if (fallback.kind === 'default') {
        return [ await dependencies.createDefaultReporter() ];
    }

    return [];
}

async function createCommandLineConfig(
    loadedConfig: LoadedRunConfig,
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineRunnerDependencies
): Promise<RunConfig> {
    const reporterFallback = selectCommandLineReporterFallback(loadedConfig, request.request.profile);

    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters: await loadCommandLineReporterFallback(reporterFallback, dependencies),
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

async function createCommandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedRunConfig,
    dependencies: CommandLineRunnerDependencies
): Promise<RunCommand> {
    return {
        config: await createCommandLineConfig(loadedConfig, request, dependencies),
        cwd: request.cwd,
        engine: { kind: 'default' },
        request: {
            ...request.request,
            capabilityRestrictions: { mode: 'enabled' }
        }
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
        fallbackDiagnostics: readFallbackDiagnostics(runResult, resolveCommandReporters(command)),
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
