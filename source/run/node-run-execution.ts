import { createExecute } from '../engine/execution.ts';
import { createNodeFileStore } from '../file-store.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { createWorkerPoolWithHostProcess } from './node-worker-pool-factory.ts';
import { createNodeProcessUsageTracker } from './process-usage.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type NodeExecutionCallbacks = Pick<
    RunOrchestratorDependencies,
    'reporterDispatcher' | 'startWorkerPoolHost' | 'wallClock'
>;
type NodeExecutionInput = NodeExecutionCallbacks & {
    readonly readEnvironment: RunOrchestratorDependencies['runtimeCapabilityPolicy']['readEnvironment'];
};
type RuntimeStateDependencies = Pick<
    RunOrchestratorDependencies,
    'createHistoryStorage' | 'maintainHistory' | 'runtimeStateStore'
>;
type ExecutionDependencies = Pick<
    RunOrchestratorDependencies,
    'createProcessUsageTracker' | 'createWorkerPool' | 'execute'
>;
type NodeExecutionDependencies = ExecutionDependencies & RuntimeStateDependencies;

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export function createNodeExecutionDependencies(input: NodeExecutionInput): NodeExecutionDependencies {
    return {
        createHistoryStorage: createNodeHistoryStorage,
        async maintainHistory(options) {
            const { maintainHistory } = await import('./history-maintenance.ts');
            return await maintainHistory(options);
        },
        createProcessUsageTracker(options) {
            return createNodeProcessUsageTracker(input.wallClock, options);
        },
        createWorkerPool(options) {
            return createWorkerPoolWithHostProcess(options, input.readEnvironment(), input.startWorkerPoolHost);
        },
        execute: createExecute({
            benchmarkEnvironment: null,
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes,
            reporterDispatcher: input.reporterDispatcher,
            wallClock: input.wallClock
        }),
        runtimeStateStore: createNodeFileStore()
    };
}
