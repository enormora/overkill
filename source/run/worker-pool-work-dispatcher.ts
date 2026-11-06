import { createReplayDispatcher } from './replay-dispatcher.ts';
import { currentReplay } from './replay-context.ts';
import { createDynamicDispatcher } from './worker-pool-dynamic-dispatcher.ts';
import { createStaticDispatcher } from './worker-pool-static-dispatcher.ts';
import { workerPoolPlacementTrace, type WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import type { PlacementPlan } from './run-types.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';

export function createWorkDispatcher(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): WorkerPoolWorkDispatcher {
    const { execution } = runtime.resolvedRun.facts;
    const replay = currentReplay();
    if (execution.processModel !== 'worker-pool' || execution.dispatchPolicy === 'static-assignment') {
        return createStaticDispatcher(plan, workerPoolPlacementTrace(runtime));
    }

    return replay?.kind === 'record'
        ? createReplayDispatcher(runtime, plan, replay.record)
        : createDynamicDispatcher(runtime, plan);
}
