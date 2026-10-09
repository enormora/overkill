import type { Engine } from '../engine/engine.ts';
import {
    createCommandLineRunner,
    loadDefaultLineReporter,
    type CommandLineRunner,
    type CommandLineRunnerDependencies
} from './command-line-runner.ts';
import {
    createCurrentProcessRunOrchestrator,
    type CurrentProcessRunOrchestratorDependencies
} from './current-process-run-orchestrator.ts';
import {
    loadUnimplementedBaselineCommands
} from './command-line-unimplemented-commands.ts';

type NodeCommandLineRunDiscovery = CurrentProcessRunOrchestratorDependencies['discoverRunFilesWithProjectRoot'];
type NodeCommandLineStartSupervisedChild = CurrentProcessRunOrchestratorDependencies['startSupervisedChild'];
type NodeCommandLineStartWorkerPoolHost = CurrentProcessRunOrchestratorDependencies['startWorkerPoolHost'];

type NodeCommandLineRunnerDependencies = {
    readonly discoverRunFilesWithProjectRoot: NodeCommandLineRunDiscovery;
    readonly loadConfig: CommandLineRunnerDependencies['loadConfig'];
    readonly loadRunEngineModule: CurrentProcessRunOrchestratorDependencies['loadRunEngineModule'];
    readonly loadRunTestModules: CurrentProcessRunOrchestratorDependencies['loadRunTestModules'];
    readonly startSupervisedChild: NodeCommandLineStartSupervisedChild;
    readonly startWorkerPoolHost: NodeCommandLineStartWorkerPoolHost;
};

export type NodeCommandLineRunnerOptions = {
    readonly defaultEngine: Engine;
};

export type NodeCommandLineRunnerInput = NodeCommandLineRunnerOptions & {
    readonly dependencies: NodeCommandLineRunnerDependencies;
};

export function createNodeCommandLineRunner(input: NodeCommandLineRunnerInput): CommandLineRunner {
    const orchestrator = createCurrentProcessRunOrchestrator(input.defaultEngine, {
        discoverRunFilesWithProjectRoot: input.dependencies.discoverRunFilesWithProjectRoot,
        loadRunEngineModule: input.dependencies.loadRunEngineModule,
        loadRunTestModules: input.dependencies.loadRunTestModules,
        startSupervisedChild: input.dependencies.startSupervisedChild,
        startWorkerPoolHost: input.dependencies.startWorkerPoolHost
    });

    return createCommandLineRunner({
        createDefaultReporter: loadDefaultLineReporter,
        loadBaselineCommands: loadUnimplementedBaselineCommands,
        async loadBenchmarkCommands() {
            const { createBenchmarkCommands } = await import('./benchmark-commands.ts');

            return createBenchmarkCommands({
                createDefaultReporter: loadDefaultLineReporter,
                loadConfig: input.dependencies.loadConfig,
                orchestrator
            });
        },
        loadConfig: input.dependencies.loadConfig,
        orchestrator
    });
}
