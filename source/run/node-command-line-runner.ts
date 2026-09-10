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
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from './command-line-unimplemented-commands.ts';

type NodeCommandLineRunDiscovery = CurrentProcessRunOrchestratorDependencies['discoverRunFilesWithProjectRoot'];
type NodeCommandLineStartSupervisedChild = CurrentProcessRunOrchestratorDependencies['startSupervisedChild'];

type NodeCommandLineRunnerDependencies = {
    readonly discoverRunFilesWithProjectRoot: NodeCommandLineRunDiscovery;
    readonly loadRunConfig: CommandLineRunnerDependencies['loadRunConfig'];
    readonly loadRunEngineModule: CurrentProcessRunOrchestratorDependencies['loadRunEngineModule'];
    readonly loadRunTestModules: CurrentProcessRunOrchestratorDependencies['loadRunTestModules'];
    readonly startSupervisedChild: NodeCommandLineStartSupervisedChild;
};

export type NodeCommandLineRunnerOptions = {
    readonly defaultEngine: Engine;
};

export type NodeCommandLineRunnerInput = NodeCommandLineRunnerOptions & {
    readonly dependencies: NodeCommandLineRunnerDependencies;
};

export function createNodeCommandLineRunner(input: NodeCommandLineRunnerInput): CommandLineRunner {
    return createCommandLineRunner({
        createDefaultReporter: loadDefaultLineReporter,
        loadBaselineCommands: loadUnimplementedBaselineCommands,
        loadBenchmarkCommands: loadUnimplementedBenchmarkCommands,
        loadRunConfig: input.dependencies.loadRunConfig,
        orchestrator: createCurrentProcessRunOrchestrator(input.defaultEngine, {
            discoverRunFilesWithProjectRoot: input.dependencies.discoverRunFilesWithProjectRoot,
            loadRunEngineModule: input.dependencies.loadRunEngineModule,
            loadRunTestModules: input.dependencies.loadRunTestModules,
            startSupervisedChild: input.dependencies.startSupervisedChild
        })
    });
}
