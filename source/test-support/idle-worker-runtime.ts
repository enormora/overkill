import type { PlacementPlan } from '../run/run-types.ts';
import {
    type WorkerPoolRunRuntime,
    createWorkerPoolRuntime,
    workerPoolExecutionFacts,
    workerPoolPlacementPlan
} from '../run/worker-pool-runtime.ts';
import { createSupervisedRunState } from '../run/supervised-run-state.ts';
import { workerPoolOrchestration, workerOrchestrationFaults } from './worker-pool-orchestration.ts';

async function runtimeWithPlacement(
    timed: boolean,
    change: (plan: PlacementPlan) => PlacementPlan
): Promise<WorkerPoolRunRuntime> {
    const fixture = workerPoolOrchestration(workerOrchestrationFaults, timed);
    const placement = change(workerPoolPlacementPlan(fixture.resolved));
    const execution = workerPoolExecutionFacts(fixture.resolved);
    const resolvedRun = {
        ...fixture.resolved,
        facts: {
            ...fixture.resolved.facts,
            execution: { ...execution, placementPlan: placement }
        }
    };
    return await createWorkerPoolRuntime({
        attachments: null,
        collectionRunnerErrors: [],
        createdPool: null,
        dependencies: fixture.dependencies,
        async finalizeResult(completion) {
            return await fixture.options.finalizeResult(resolvedRun, completion);
        },
        resolvedRun,
        runState: createSupervisedRunState('first-failure-and-final'),
        timing: fixture.options.timing
    });
}

export async function idleWorkerRuntime(timed: boolean): Promise<WorkerPoolRunRuntime> {
    return await runtimeWithPlacement(timed, function (plan) {
        return { ...plan, lanes: [], units: [], assignments: [] };
    });
}
export async function resourceOwnerRuntime(timed: boolean): Promise<WorkerPoolRunRuntime> {
    return await runtimeWithPlacement(timed, function (plan) {
        const first = plan.units[0];
        if (first === undefined) {
            throw new Error('Missing planned work.');
        }
        return {
            ...plan,
            resourceOwnership: {
                owners: [ {
                    boundaryKey: 'owner',
                    resourceName: 'owner',
                    scope: 'per-run',
                    placement: { kind: 'infrastructure-worker', id: 'resource-owner' },
                    work: first.work
                } ]
            }
        };
    });
}
