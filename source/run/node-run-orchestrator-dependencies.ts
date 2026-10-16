import os from 'node:os';
import { createClock } from '@enormora/clock';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createNodeExecutionDependencies } from './node-run-execution.ts';
import { createRandomRunSeed } from './run-seed.ts';
import type { RunOrchestratorDependencies, WorkerPoolHostProcessStarter } from './run-orchestrator-dependencies.ts';

type RuntimeCapabilityPolicyInput = RunOrchestratorDependencies['runtimeCapabilityPolicy'];

export type NodeRunOrchestratorInput = {
    readonly defaultEngine: RunOrchestratorDependencies['defaultEngine'];
    readonly discoverRunFilesWithProjectRoot: RunOrchestratorDependencies['discoverRunFilesWithProjectRoot'];
    readonly observeIpcListeners: RuntimeCapabilityPolicyInput['observeIpcListeners'];
    readonly observeProcessExit: RuntimeCapabilityPolicyInput['observeProcessExit'];
    readonly node: RunOrchestratorDependencies['node'];
    readonly readEnvironment: RuntimeCapabilityPolicyInput['readEnvironment'];
    readonly readStorage: RuntimeCapabilityPolicyInput['readStorage'];
    readonly loadRunEngineModule: RunOrchestratorDependencies['loadRunEngineModule'];
    readonly loadRunTestModules: RunOrchestratorDependencies['loadRunTestModules'];
    readonly startSupervisedChild: RunOrchestratorDependencies['startSupervisedChild'];
    readonly startWorkerPoolHost: WorkerPoolHostProcessStarter;
    readonly stderr: {
        readonly write: (chunk: Uint8Array) => void;
        readonly writeLine: (line: string) => void;
    };
    readonly stdout: {
        readonly write: (chunk: Uint8Array) => void;
        readonly writeLine: (line: string) => void;
    };
};

export function createNodeRunOrchestratorDependencies(input: NodeRunOrchestratorInput): RunOrchestratorDependencies {
    const wallClock = createClock();
    const reporterDispatcher = createReporterDispatcher({
        stderr: input.stderr,
        stdout: input.stdout,
        wallClock
    });

    return {
        async collectBenchmarkHost(request) {
            const { collectBenchmarkHost } = await import('./benchmark-host.ts');
            return await collectBenchmarkHost(request, wallClock);
        },
        availableParallelism: os.availableParallelism(),
        createSeed: createRandomRunSeed,
        ...createNodeExecutionDependencies({
            readEnvironment: input.readEnvironment,
            reporterDispatcher,
            startWorkerPoolHost: input.startWorkerPoolHost,
            wallClock
        }),
        defaultEngine: input.defaultEngine,
        discoverRunFilesWithProjectRoot: input.discoverRunFilesWithProjectRoot,
        loadRunEngineModule: input.loadRunEngineModule,
        loadRunTestModules: input.loadRunTestModules,
        liveOutput: {
            stderr: { write: input.stderr.write },
            stdout: { write: input.stdout.write }
        },
        node: input.node,
        reporterDispatcher,
        startSupervisedChild: input.startSupervisedChild,
        startWorkerPoolHost: input.startWorkerPoolHost,
        runtimeCapabilityPolicy: {
            observeIpcListeners: input.observeIpcListeners,
            observeProcessExit: input.observeProcessExit,
            readEnvironment: input.readEnvironment,
            readStorage: input.readStorage
        },
        wallClock
    };
}
