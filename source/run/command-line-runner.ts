import type { Reporter } from '../engine/reporter.ts';
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
    formatRunnerErrorDiagnostics,
    commandLineExitCodes,
    type CommandLineListTestsRequest,
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
    selectCommandLineReporterFallback,
    type CommandLineReporterFallback
} from './run-reporter-resolution.ts';
import { renderResolvedRunList } from './run-list-renderer.ts';

export type CommandLineRunner = {
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
    readonly listTests: (request: CommandLineListTestsRequest) => Promise<CommandLineRunnerResult>;
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
    const reporterFallback = selectCommandLineReporterFallback(loadedConfig, request.runRequest.profile);

    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters: await loadCommandLineReporterFallback(reporterFallback, dependencies),
        runtimeStateDir: loadedConfig.runtimeStateDir
    };
}

function createCommandLineListConfig(loadedConfig: LoadedRunConfig): RunConfig {
    return {
        loader: loadedConfig.loader,
        outputRenderer: loadedConfig.outputRenderer,
        profiles: loadedConfig.profiles,
        reporters: [],
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
            ...request.runRequest,
            capabilityRestrictions: { mode: 'enabled' }
        }
    };
}

function createCommandFromListRequest(
    request: CommandLineListTestsRequest,
    loadedConfig: LoadedRunConfig
): RunCommand {
    return {
        config: createCommandLineListConfig(loadedConfig),
        cwd: request.cwd,
        engine: { kind: 'default' },
        request: {
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            capture: 'buffered',
            debug: {
                mode: 'off',
                selectors: []
            },
            execution: { mode: 'profile-default' },
            measureResourceUsage: null,
            order: 'plan',
            paths: request.listRequest.paths,
            profile: request.listRequest.profile,
            resourceBudgetOverrides: null,
            resourceUsageSamplingIntervalMilliseconds: null,
            seed: { value: null },
            selection: { kind: 'all' },
            shard: { index: 0, total: 1 },
            verbose: false
        }
    };
}

async function runTestsWithLoadedConfig(
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedRunConfig
): Promise<CommandLineRunnerResult> {
    const command = await createCommandFromRequest(request, loadedConfig, dependencies);
    const runResult = await dependencies.orchestrator.runWithReporterDelivery(command);

    return {
        exitCode: readExitCodeFromRunResult(runResult.result),
        fallbackDiagnostics: formatFallbackDiagnostics(
            runResult.result,
            new Set(runResult.deliveredRunnerErrors)
        ),
        runResult: runResult.result,
        stdoutLines: []
    };
}

async function listTestsWithLoadedConfig(
    request: CommandLineListTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedRunConfig
): Promise<CommandLineRunnerResult> {
    const command = createCommandFromListRequest(request, loadedConfig);
    const resolvedRun = await dependencies.orchestrator.resolve(command);

    if (resolvedRun.collectionRunnerErrors.length > 0) {
        return {
            exitCode: commandLineExitCodes.runnerError,
            fallbackDiagnostics: formatRunnerErrorDiagnostics(resolvedRun.collectionRunnerErrors),
            runResult: null,
            stdoutLines: []
        };
    }

    return {
        exitCode: commandLineExitCodes.pass,
        fallbackDiagnostics: [],
        runResult: null,
        stdoutLines: renderResolvedRunList(resolvedRun, {
            withOrphans: request.listRequest.withOrphans
        })
    };
}

export function createCommandLineRunner(dependencies: CommandLineRunnerDependencies): CommandLineRunner {
    const commandNamespace = createCommandLineCommandNamespace(dependencies);

    return {
        baseline: commandNamespace.baseline,
        bench: commandNamespace.bench,
        async listTests(request) {
            try {
                const loadedConfig = await dependencies.loadRunConfig(request);
                return await listTestsWithLoadedConfig(request, dependencies, loadedConfig);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        },
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
