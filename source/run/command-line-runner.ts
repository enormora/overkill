import type { DefinedReporter } from '../engine/reporter.ts';

import type {
    LoadedConfig,
    ConfigLoadRequest
} from '../config/config.ts';
import {
    createCommandLineConfig,
    createCommandLineListConfig,
    type CommandLineConfigDependencies
} from './command-line-config.ts';
import type { RunCommand, RunOrchestrator } from './run-types.ts';

import {
    createCommandLineErrorResultFromUnknown,
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
import { createUnimplementedCommand } from './command-line-unimplemented-commands.ts';

import { renderResolvedRunList } from './run-list-renderer.ts';
import { createDefaultDirectReporter } from './default-direct-reporter.ts';
import {
    createSystemRunTimingMeasurement,
    emptyTimingSpanMetadata,
    type RunInvocationTimingOptions
} from './run-timing-collection.ts';

export type CommandLineRunner = {
    readonly baseline: CommandLineBaselineCommands;
    readonly bench: CommandLineBenchmarkCommands;
    readonly listTests: (request: CommandLineListTestsRequest) => Promise<CommandLineRunnerResult>;
    readonly replayRun: CommandLineCommand;
    readonly replayWitness: CommandLineCommand;
    readonly runTests: (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>;
};

export type CommandLineRunnerResult = CommandLineRunnerResultShape;

export type CommandLineRunnerDependencies = CommandLineCommandLoaders & CommandLineConfigDependencies & {
    readonly loadConfig: (request: ConfigLoadRequest) => Promise<LoadedConfig>;
    readonly orchestrator: RunOrchestrator;
};

async function createCommandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedConfig,
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
    loadedConfig: LoadedConfig
): RunCommand {
    return {
        config: createCommandLineListConfig(loadedConfig, request.listRequest.profile),
        cwd: request.cwd,
        engine: { kind: 'default' },
        request: {
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            capture: 'buffered',
            coverage: false,
            debug: {
                mode: 'off',
                selectors: []
            },
            execution: { mode: 'profile-default' },
            measureResourceUsage: null,
            order: request.listRequest.order,
            paths: request.listRequest.paths,
            profile: request.listRequest.profile,
            resourceBudgetOverrides: null,
            resourceUsageSamplingIntervalMilliseconds: null,
            seed: request.listRequest.seed,
            selection: request.listRequest.selection,
            shard: request.listRequest.shard,
            timingCollection: 'profile-default',
            verbose: false,
            workers: null
        }
    };
}

async function runTestsWithLoadedConfig(
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedConfig,
    options: RunInvocationTimingOptions
): Promise<CommandLineRunnerResult> {
    const command = await createCommandFromRequest(request, loadedConfig, dependencies);
    const runResult = await dependencies.orchestrator.runWithReporterDelivery(command, options);

    return {
        exitCode: readExitCodeFromRunResult(runResult.result),
        fallbackDiagnostics: formatRunnerErrorDiagnostics(runResult.undeliveredRunnerErrors),
        runResult: runResult.result,
        stdoutLines: []
    };
}

async function listTestsWithLoadedConfig(
    request: CommandLineListTestsRequest,
    dependencies: CommandLineRunnerDependencies,
    loadedConfig: LoadedConfig
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
            withLocations: request.listRequest.withLocations,
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
                const loadedConfig = await dependencies.loadConfig(request);
                return await listTestsWithLoadedConfig(request, dependencies, loadedConfig);
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        },
        replayRun: createUnimplementedCommand('replay'),
        replayWitness: createUnimplementedCommand('replay-witness'),
        async runTests(request) {
            const timing = createSystemRunTimingMeasurement();

            try {
                const loadedConfig = await timing.measureAsync(
                    'config.load',
                    emptyTimingSpanMetadata(),
                    async function loadRunTestsConfig() {
                        return await dependencies.loadConfig(request);
                    }
                );

                return await runTestsWithLoadedConfig(request, dependencies, loadedConfig, { timing });
            } catch (error: unknown) {
                return createCommandLineErrorResultFromUnknown(error);
            }
        }
    };
}

export async function loadDefaultLineReporter(): Promise<DefinedReporter> {
    return await createDefaultDirectReporter();
}
