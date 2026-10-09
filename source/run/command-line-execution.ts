import type { LoadedConfig } from '../config/config.ts';
import { selectTestProfile } from './test-profile.ts';
import {
    createCommandLineConfig,
    createCommandLineListConfig,
    type CommandLineConfigDependencies
} from './command-line-config.ts';
import type { RunCommand, RunOrchestrator } from './run-types.ts';
import {
    commandLineExitCodes,
    formatRunnerErrorDiagnostics,
    readExitCodeFromRunResult,
    type CommandLineListTestsRequest,
    type CommandLineRunTestsRequest,
    type CommandLineRunnerResult
} from './command-line-command.ts';
import { renderResolvedRunList } from './run-list-renderer.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

export type CommandLineExecutionDependencies = CommandLineConfigDependencies & {
    readonly orchestrator: {
        readonly resolve: (
            command: RunCommand,
            options: RunInvocationTimingOptions
        ) => ReturnType<RunOrchestrator['resolve']>;
        readonly runWithReporterDelivery: (
            command: RunCommand,
            options: RunInvocationTimingOptions
        ) => ReturnType<RunOrchestrator['runWithReporterDelivery']>;
    };
};

export function assertOrdinaryCommandProfile(profileName: string, config: LoadedConfig): void {
    if (config.profiles[profileName]?.testFamily === 'benchmark') {
        selectTestProfile(profileName, config);
    }
}

async function createCommandFromRequest(
    request: CommandLineRunTestsRequest,
    loadedConfig: LoadedConfig,
    dependencies: CommandLineExecutionDependencies
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

export async function runTestsWithLoadedConfig(
    request: CommandLineRunTestsRequest,
    dependencies: CommandLineExecutionDependencies,
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

export async function listTestsWithLoadedConfig(
    request: CommandLineListTestsRequest,
    dependencies: CommandLineExecutionDependencies,
    loadedConfig: LoadedConfig
): Promise<CommandLineRunnerResult> {
    const command = createCommandFromListRequest(request, loadedConfig);
    const resolvedRun = await dependencies.orchestrator.resolve(command, { timing: null });

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
