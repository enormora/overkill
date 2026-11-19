import type { WorkerPoolExecutionOptions } from '../run/worker-pool-run.ts';
import type { WorkerPoolTask, WorkerPoolCommand } from '../run/worker-pool-protocol.ts';
import type {
    RunOrchestratorDependencies,
    WorkerPoolCreationOptions,
    CreatedWorkerPool
} from '../run/run-orchestrator-dependencies.ts';
import type { CollectedRunPlan, ResolvedRun } from '../run/run-types.ts';
import type { WorkerPoolRunCompletion } from '../run/worker-pool-runtime.ts';
import { createRunTimingMeasurement } from '../run/run-timing-collection.ts';
import { fakeDependencies, createCollectedPlan, workerPoolResolvedRun } from './worker-pool-execution-state.ts';
import { workerTaskRuntime } from './worker-task-runtime.ts';
import { runResultFactory } from './run-result-factory.ts';

export type WorkerOrchestrationFaults = {
    readonly collection: Error | null;
    readonly execution: Error | null;
    readonly destruction: Error | null;
    readonly finalization: Error | null;
};
export const workerOrchestrationFaults: WorkerOrchestrationFaults = {
    collection: null,
    execution: null,
    destruction: null,
    finalization: null
};
type WorkerOrchestrationFixture = {
    readonly resolved: ResolvedRun;
    readonly command: WorkerPoolCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly options: WorkerPoolExecutionOptions;
    readonly created: readonly WorkerPoolCreationOptions[];
    readonly events: readonly string[];
    readonly completions: readonly WorkerPoolRunCompletion[];
};
function isWorkerTask(task: unknown): task is WorkerPoolTask {
    return task !== null && typeof task === 'object' && Object.hasOwn(task, 'port') &&
        typeof Reflect.get(task, 'kind') === 'string';
}
export function completeWorkerExecution(task: Extract<WorkerPoolTask, { readonly kind: 'run'; }>): unknown {
    const results = task.assignedUnits.map(function (unit) {
        task.port.postMessage({ kind: 'attempt-started', attempt: unit.attempt, workerId: '1:1' }, []);
        const result = runResultFactory.build({
            perTest: unit.work.map(function (workId) {
                return { id: workId.case, workId, outcome: { kind: 'pass' } };
            })
        });
        task.port.postMessage({ kind: 'attempt-completed', attempt: unit.attempt, durationMicroseconds: 1 }, []);
        return { traceUnit: unit.traceUnit, result };
    });
    task.port.postMessage({ kind: 'task-messages-completed' }, []);
    return { results };
}

function executeWorkerRequest(
    task: WorkerPoolTask,
    collectedPlan: CollectedRunPlan,
    faults: WorkerOrchestrationFaults
): unknown {
    if (task.kind === 'collect') {
        task.port.close();
        if (faults.collection !== null) {
            throw faults.collection;
        }
        return { collectedPlan, runnerErrors: [] };
    }
    if (task.kind === 'run') {
        if (faults.execution !== null) {
            throw faults.execution;
        }
        return completeWorkerExecution(task);
    }
    throw new Error('Unexpected resource task.');
}

export function workerPoolOrchestration(faults: WorkerOrchestrationFaults, timed: boolean): WorkerOrchestrationFixture {
    const originalPlan = createCollectedPlan();
    const collectedPlan = { ...originalPlan, discoveredFiles: originalPlan.files };
    const resolved = workerPoolResolvedRun(collectedPlan);
    const created: WorkerPoolCreationOptions[] = [];
    const events: string[] = [];
    const completions: WorkerPoolRunCompletion[] = [];
    const dependencies: RunOrchestratorDependencies = {
        ...fakeDependencies(),
        createWorkerPool(options) {
            created.push(options);
            const pool: CreatedWorkerPool = {
                options: {
                    maxThreads: options.workerCount,
                    isolateWorkers: options.workerLifecycle === 'fresh-worker-per-unit'
                },
                setHostOutputSink(sink) {
                    events.push(sink === null ? 'output:clear' : 'output:observe');
                    sink?.('stdout', Buffer.from('host output'));
                },
                async destroy() {
                    events.push('destroy');
                    if (faults.destruction !== null) {
                        throw faults.destruction;
                    }
                },
                async run(task) {
                    if (!isWorkerTask(task)) {
                        throw new Error('Invalid worker request.');
                    }
                    events.push(task.kind);
                    return executeWorkerRequest(task, collectedPlan, faults);
                }
            };
            return pool;
        }
    };
    const options: WorkerPoolExecutionOptions = {
        record: null,
        timing: timed ? createRunTimingMeasurement(dependencies.wallClock) : null,
        async finalizeResult(_run, completion) {
            completions.push(completion);
            if (faults.finalization !== null) {
                throw faults.finalization;
            }
            return completion.result;
        }
    };
    return {
        resolved,
        command: workerTaskRuntime(null, null).task.command,
        dependencies,
        options,
        created,
        events,
        completions
    };
}
