import type { CommandLineRunner } from '../../run/command-line-runner.ts';
import type { NodeCommandLineRunnerOptions } from '../../run/node-command-line-runner.ts';
import { createCommandLineCommandNamespace } from '../../run/command-line-command-namespace.ts';
import {
    createUnimplementedCommand,
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from '../../run/command-line-unimplemented-commands.ts';
import { loadRunConfig } from './config.entry-point.ts';

export {
    commandLineExitCodes
} from '../../run/command-line-command.ts';
export {
    defineConfig,
    loadRunConfig,
    RunConfigError
} from './config.entry-point.ts';

const commandLoaders = {
    loadBaselineCommands: loadUnimplementedBaselineCommands,
    loadBenchmarkCommands: loadUnimplementedBenchmarkCommands
};

export function createNodeCommandLineRunner(options: NodeCommandLineRunnerOptions): CommandLineRunner {
    const nodeCommandNamespace = createCommandLineCommandNamespace(commandLoaders);
    let runner: Promise<CommandLineRunner> | null = null;
    const loadRunner = async function loadNodeCommandLineRunner(): Promise<CommandLineRunner> {
        if (runner === null) {
            runner = (async function createRunner() {
                const [
                    runnerModule,
                    runDependencies,
                    childProcessStarters
                ] = await Promise.all([
                    import('../../run/node-command-line-runner.ts'),
                    import('../../run/node-run-dependencies.entry-point.ts'),
                    import('../../run/node-child-process-starters.ts')
                ]);

                return runnerModule.createNodeCommandLineRunner({
                    defaultEngine: options.defaultEngine,
                    dependencies: {
                        discoverRunFilesWithProjectRoot: runDependencies.runDiscovery.discoverRunFilesWithProjectRoot,
                        loadRunEngineModule: runDependencies.loadRunEngineModule,
                        loadRunTestModules: runDependencies.loadRunTestModules,
                        loadRunConfig,
                        startSupervisedChild: childProcessStarters.startSupervisedChild,
                        startWorkerPoolHost: childProcessStarters.startWorkerPoolHost
                    }
                });
            })();
        }

        return await runner;
    };

    return {
        baseline: nodeCommandNamespace.baseline,
        bench: nodeCommandNamespace.bench,
        async listTests(request) {
            const loadedRunner = await loadRunner();

            return await loadedRunner.listTests(request);
        },
        replayRun: createUnimplementedCommand('replay'),
        replayWitness: createUnimplementedCommand('replay-witness'),
        async runTests(request) {
            const loadedRunner = await loadRunner();

            return await loadedRunner.runTests(request);
        }
    };
}

async function loadDefaultRunner(): Promise<CommandLineRunner> {
    const [
        dependenciesModule,
        runnerModule,
        childProcessStarters,
        defaultEngineModule
    ] = await Promise.all([
        import('../../run/node-run-dependencies.entry-point.ts'),
        import('../../run/node-command-line-runner.ts'),
        import('../../run/node-child-process-starters.ts'),
        import('../../run/default-run-engine.ts')
    ]);

    return runnerModule.createNodeCommandLineRunner({
        defaultEngine: defaultEngineModule.defaultRunEngine,
        dependencies: {
            discoverRunFilesWithProjectRoot: dependenciesModule.runDiscovery.discoverRunFilesWithProjectRoot,
            loadRunEngineModule: dependenciesModule.loadRunEngineModule,
            loadRunTestModules: dependenciesModule.loadRunTestModules,
            loadRunConfig,
            startSupervisedChild: childProcessStarters.startSupervisedChild,
            startWorkerPoolHost: childProcessStarters.startWorkerPoolHost
        }
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
    RunProjectTimingProfilePolicy,
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
