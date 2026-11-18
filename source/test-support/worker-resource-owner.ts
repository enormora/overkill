import { z } from 'zod/v4';
import type { PlacementPlan } from '../run/run-types.ts';
import {
    workerPoolPlacementPlan,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from '../run/worker-pool-runtime.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    type WorkerPoolResourceLifecycle
} from '../run/worker-pool-resource-lifecycle-execution.ts';
import { createTaskRun } from './worker-pool-execution-state.ts';
import { resourceOwnerRuntime } from './idle-worker-runtime.ts';

type WorkerResourceOwner = {
    readonly runtime: WorkerPoolRunRuntime;
    readonly plan: PlacementPlan;
    readonly lifecycle: WorkerPoolResourceLifecycle;
    readonly calls: readonly string[];
    readonly members: WorkerPoolTaskRun['members'];
};
export async function workerResourceOwner(output: unknown): Promise<WorkerResourceOwner> {
    const source = await resourceOwnerRuntime(false);
    const original = workerPoolPlacementPlan(source.resolvedRun);
    const plan = {
        ...original,
        resourceOwnership: {
            owners: original.resourceOwnership.owners.map(function (owner) {
                return { ...owner, scope: 'per-file' as const };
            })
        }
    };
    const calls: string[] = [];
    const runtime = {
        ...source,
        pool: {
            ...source.pool,
            async run(task: unknown) {
                const { kind } = z.object({ kind: z.string() }).parse(task);
                calls.push(kind);
                if (kind === 'acquire-run-resources') {
                    return {
                        projectedResources: { resources: [ { boundaryKey: 'owner', payload: 'handle' } ] },
                        runnerErrors: []
                    };
                }
                if (output instanceof Error) {
                    throw output;
                }
                return output;
            }
        }
    };
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, plan);
    return { runtime, plan, lifecycle, calls, members: createTaskRun(runtime.runState).members };
}
