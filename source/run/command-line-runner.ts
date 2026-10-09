import type { DefinedReporter } from '../engine/reporter.ts';

import type {
    LoadedConfig,
    ConfigLoadRequest
} from '../config/config.ts';
import type {
    CommandLineConfigDependencies
} from './command-line-config.ts';
import type { RunOrchestrator } from './run-types.ts';

import {
    createCommandLineErrorResultFromUnknown,
    type CommandLineListTestsRequest,
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

import {
    assertOrdinaryCommandProfile,
    runTestsWithLoadedConfig,
    listTestsWithLoadedConfig
} from './command-line-execution.ts';
import { createDefaultDirectReporter } from './default-direct-reporter.ts';
import {
    createSystemRunTimingMeasurement,
    emptyTimingSpanMetadata
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

export function createCommandLineRunner(dependencies: CommandLineRunnerDependencies): CommandLineRunner {
    const commandNamespace = createCommandLineCommandNamespace(dependencies);

    return {
        baseline: commandNamespace.baseline,
        bench: commandNamespace.bench,
        async listTests(request) {
            try {
                const loadedConfig = await dependencies.loadConfig(request);
                assertOrdinaryCommandProfile(request.listRequest.profile, loadedConfig);
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

                assertOrdinaryCommandProfile(request.runRequest.profile, loadedConfig);
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
