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
    'createExecution' | 'createProcessUsageTracker' | 'createWorkerPool' | 'execute'
>;
type NodeExecutionDependencies = ExecutionDependencies & RuntimeStateDependencies;

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export function createNodeExecutionDependencies(input: NodeExecutionInput): NodeExecutionDependencies {
    function createExecution(
        reporterDispatcher: NodeExecutionInput['reporterDispatcher']
    ): RunOrchestratorDependencies['execute'] {
        return createExecute({
            benchmarkEnvironment: null,
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes,
            reporterDispatcher,
            wallClock: input.wallClock
        });
    }
    return {
        createExecution,
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
        execute: createExecution(input.reporterDispatcher),
        runtimeStateStore: createNodeFileStore()
    };
}
