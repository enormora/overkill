import {
    createNodeCommandLineRunner as createNodeCommandLineRunnerWithDependencies,
    type NodeCommandLineRunnerOptions
} from '../../run/node-command-line-runner.ts';
import {
    createCommandLineRunner,
    loadDefaultLineReporter,
    type CommandLineRunner
} from '../../run/command-line-runner.ts';
import { createCommandLineCommandNamespace } from '../../run/command-line-command-namespace.ts';
import {
    createUnimplementedCommand,
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from '../../run/command-line-unimplemented-commands.ts';
import { startSupervisedChild } from '../../run/run-orchestrator.entry-point.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from '../../run/node-run-dependencies.entry-point.ts';
import { loadRunConfig } from './config.entry-point.ts';

export {
    commandLineExitCodes
} from '../../run/command-line-command.ts';
export {
    defineConfig,
    loadRunConfig,
    RunConfigError
} from './config.entry-point.ts';

export function createNodeCommandLineRunner(options: NodeCommandLineRunnerOptions): CommandLineRunner {
    return createNodeCommandLineRunnerWithDependencies({
        defaultEngine: options.defaultEngine,
        dependencies: {
            discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
            loadRunEngineModule,
            loadRunTestModules,
            loadRunConfig,
            startSupervisedChild
        }
    });
}

const commandLoaders = {
    loadBaselineCommands: loadUnimplementedBaselineCommands,
    loadBenchmarkCommands: loadUnimplementedBenchmarkCommands
};

async function loadDefaultRunner(): Promise<CommandLineRunner> {
    const module = await import('../../run/run-orchestrator.entry-point.ts');

    return createCommandLineRunner({
        createDefaultReporter: loadDefaultLineReporter,
        ...commandLoaders,
        loadRunConfig,
        orchestrator: module.orchestrator
    });
}

const commandNamespace = createCommandLineCommandNamespace(commandLoaders);

export const commandLineRunner: CommandLineRunner = {
    baseline: commandNamespace.baseline,
    bench: commandNamespace.bench,
    replayRun: createUnimplementedCommand('replay'),
    replayWitness: createUnimplementedCommand('replay-witness'),
    async listTests(request) {
        const runner = await loadDefaultRunner();

        return await runner.listTests(request);
    },
    async runTests(request) {
        const runner = await loadDefaultRunner();

        return await runner.runTests(request);
    }
};

export type {
    CommandLineBaselineCommands,
    CommandLineBenchmarkCommands,
    CommandLineCommand,
    CommandLineCommandContext,
    CommandLineExitCode,
    CommandLineListTestsRequest,
    CommandLineRunnerResult,
    CommandLineRunTestsRequest
} from '../../run/command-line-command.ts';
export type {
    CommandLineRunner,
    CommandLineRunnerDependencies
} from '../../run/command-line-runner.ts';
export type {
    NodeCommandLineRunnerOptions
} from '../../run/node-command-line-runner.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
    RunProjectConfig,
    RunProjectIntegrationExecution,
    RunProjectIntegrationProfileConfig,
    RunProjectMeasuredResourceUsage,
    RunProjectMicrotestExecution,
    RunProjectMicrotestProfileConfig,
    RunProjectProfileFiles,
    RunProjectProfileConfig,
    RunProjectProfilesConfig,
    RunProjectResourceBudgets,
    RunProjectResourceUsageConfig,
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
