import { createExecute } from '../engine/execution.ts';
import { createNodeFileStore } from '../file-store.ts';
import { createWorkerPoolWithHostProcess } from './node-worker-pool-factory.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type NodeExecutionCallbacks = Pick<
    RunOrchestratorDependencies,
    'reporterDispatcher' | 'startWorkerPoolHost' | 'wallClock'
>;
type NodeExecutionInput = NodeExecutionCallbacks & {
    readonly readEnvironment: RunOrchestratorDependencies['runtimeCapabilityPolicy']['readEnvironment'];
};
type NodeExecutionDependencies = Pick<
    RunOrchestratorDependencies,
    'createResourceUsageTracker' | 'createWorkerPool' | 'execute' | 'runtimeStateStore'
>;

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export function createNodeExecutionDependencies(input: NodeExecutionInput): NodeExecutionDependencies {
    return {
        createResourceUsageTracker(options) {
            return createNodeResourceUsageTracker(input.wallClock, options);
        },
        createWorkerPool(options) {
            return createWorkerPoolWithHostProcess(options, input.readEnvironment(), input.startWorkerPoolHost);
        },
        execute: createExecute({
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes,
            reporterDispatcher: input.reporterDispatcher,
            wallClock: input.wallClock
        }),
        runtimeStateStore: createNodeFileStore()
    };
}
