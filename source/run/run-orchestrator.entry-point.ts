import { createCurrentProcessRunOrchestrator } from './current-process-run-orchestrator.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import {
    loadRunEngineModule,
    loadRunTestModules,
    runDiscovery
} from './node-run-dependencies.entry-point.ts';
import {
    startSupervisedChild,
    startWorkerPoolHost
} from './node-child-process-starters.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunOrchestrator } from './run-types.ts';

type CommandLineOrchestratorDependencies = Pick<
    RunOrchestratorDependencies,
    'discoverRunFilesWithProjectRoot' | 'loadRunEngineModule' | 'loadRunTestModules'
>;

function createCommandLineOrchestrator(
    dependencies: CommandLineOrchestratorDependencies
): RunOrchestrator {
    return createCurrentProcessRunOrchestrator(defaultRunEngine, {
        discoverRunFilesWithProjectRoot: dependencies.discoverRunFilesWithProjectRoot,
        loadRunEngineModule: dependencies.loadRunEngineModule,
        loadRunTestModules: dependencies.loadRunTestModules,
        startSupervisedChild,
        startWorkerPoolHost
    });
}

export const orchestrator = createCommandLineOrchestrator({
    discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
    loadRunEngineModule,
    loadRunTestModules
});
