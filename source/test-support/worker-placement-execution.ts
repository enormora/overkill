import { executeWorkerPoolUnits } from '../run/worker-pool-execution.ts';
import { recordTaskCrash, stopWorkerPoolTasks } from '../run/worker-pool-task-events.ts';
import type { WorkerPoolRunTask } from '../run/worker-pool-protocol.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from '../run/worker-pool-runtime.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { fakeWorkerRuntime, createCollectedPlan } from './worker-pool-execution-state.ts';
import { completeWorkerExecution } from './worker-pool-orchestration.ts';

export type PlacementExecutionScenario = 'host' | 'invalid' | 'none' | 'parent-retry' | 'parent-stop' | 'permission';
type WorkerPlacementFixture = {
    readonly runtime: WorkerPoolRunRuntime;
    readonly calls: () => number;
    readonly run: () => Promise<readonly WorkerPoolTaskRun[]>;
};
function isRunTask(value: unknown): value is WorkerPoolRunTask {
    return value !== null && typeof value === 'object' && Reflect.get(value, 'kind') === 'run';
}
function interruptParentTask(runtime: WorkerPoolRunRuntime, retry: boolean): void {
    const current = Array.from(runtime.activeTasks)[0];
    if (current === undefined) {
        throw new Error('Missing active worker task.');
    }
    if (retry) {
        current.endedByParent.write(true);
        current.requeuePendingCases.write(true);
        recordTaskCrash(current, runtime, 'hard-timeout', 'Worker timed out.');
        current.controller.abort();
    } else {
        stopWorkerPoolTasks(runtime, null, 'run-stopped', 'Parent stopped execution.');
    }
}

function malformedPlacement(scenario: PlacementExecutionScenario): null {
    if (scenario === 'invalid') {
        return null;
    }
    throw new Error('Worker failed.');
}

function respondToPlacement(
    task: WorkerPoolRunTask,
    runtime: WorkerPoolRunRuntime,
    scenario: PlacementExecutionScenario,
    recordHostError: (error: RunnerError) => void
): unknown {
    if (scenario === 'none') {
        return completeWorkerExecution(task);
    }
    if (scenario === 'parent-stop' || scenario === 'parent-retry') {
        interruptParentTask(runtime, scenario === 'parent-retry');
    } else if (scenario === 'permission') {
        throw Object.assign(new Error('process creation denied'), {
            code: 'ERR_ACCESS_DENIED',
            permission: 'ChildProcess',
            resource: 'node'
        });
    }
    if (scenario === 'host') {
        recordHostError({
            attributedTo: null,
            attributedToAttempt: null,
            attributedToWork: null,
            cause: null,
            diagnostics: [],
            message: 'host transport failed',
            subtype: 'crash'
        });
    }
    return malformedPlacement(scenario);
}

export function workerPlacementExecution(scenario: PlacementExecutionScenario): WorkerPlacementFixture {
    const original = fakeWorkerRuntime(createCollectedPlan());
    let calls = 0;
    const hostErrors: RunnerError[] = [];
    const runtime: WorkerPoolRunRuntime = {
        ...original,
        pool: {
            ...original.pool,
            takeHostRunnerErrors() {
                const errors = Array.from(hostErrors);
                hostErrors.length = 0;
                return errors;
            },
            async run(task) {
                if (!isRunTask(task)) {
                    throw new Error('Expected a placement run task.');
                }
                calls += 1;
                return respondToPlacement(task, runtime, scenario, function (error) {
                    hostErrors.push(error);
                });
            }
        }
    };
    return {
        runtime,
        calls() {
            return calls;
        },
        async run() {
            const plan = runtime.resolvedRun.facts.execution.placementPlan;
            if (plan === null) {
                throw new Error('Missing placement.');
            }
            return await executeWorkerPoolUnits(runtime, plan, 0);
        }
    };
}
