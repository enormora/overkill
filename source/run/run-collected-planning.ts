import type { RunFacts, RunWorkerCountFacts } from './run-types.ts';
import { createRunShardHasher, shardCollectedRunPlanCases } from './run-sharding.ts';
import { orderedRunItems } from './run-ordering.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    type WorkerPoolPlacementResolution
} from './worker-pool-placement-planning.ts';
import { constrainedScheduling, workResourceConstraints } from './work-unit-resource-constraints.ts';
import { assertCollectedPlanCompatible } from './execution-plan-resolution.ts';
import { resolveRunScheduling } from './run-profile-facts.ts';
import {
    benchmarkPlacementForCases,
    createPlacementResolution,
    type CollectedExecutionPlanInput
} from './collected-placement.ts';

type Scheduling = RunFacts['execution']['scheduling'];

export type CollectedExecutionPlan = {
    readonly benchmarkPlacement: RunFacts['benchmarkPlacement'];
    readonly durationHistory: WorkerPoolPlacementResolution['durationHistory'] | null;
    readonly orderedCases: ReturnType<typeof shardCollectedRunPlanCases>;
    readonly placementPlan: WorkerPoolPlacementResolution['placementPlan'] | null;
    readonly scheduling: Scheduling;
    readonly workerCount: RunWorkerCountFacts | null;
};

function orderedCollectedCases(
    input: CollectedExecutionPlanInput,
    placementPlan: WorkerPoolPlacementResolution['placementPlan'] | null,
    shardHasher: Awaited<ReturnType<typeof createRunShardHasher>>
): CollectedExecutionPlan['orderedCases'] {
    if (placementPlan !== null) {
        return collectedRunCaseEntriesFromWorkUnits(input.collectedPlan, placementPlan.units);
    }

    return orderedRunItems(
        shardCollectedRunPlanCases(input.collectedPlan, input.request.shard, shardHasher),
        input.request.order,
        input.request.seed
    );
}

function resolvedScheduling(
    input: CollectedExecutionPlanInput,
    orderedCases: CollectedExecutionPlan['orderedCases']
): Scheduling {
    if (input.planKind === 'worker-pool') {
        return input.profile.execution.scheduling;
    }

    const constraints = workResourceConstraints(
        orderedCases.map(function toWorkId(entry) {
            return entry.workId;
        }),
        input.collectedPlan
    );

    return constrainedScheduling(resolveRunScheduling(input.request, input.profile), constraints);
}

export async function createCollectedExecutionPlan(
    input: CollectedExecutionPlanInput
): Promise<CollectedExecutionPlan> {
    if (input.planKind === 'supervised') {
        assertCollectedPlanCompatible(input.collectedPlan);
    }

    const shardHasher = await createRunShardHasher(input.request.shard);
    const placementResolution = await createPlacementResolution(input, shardHasher);
    const planningFacts = placementResolution ?? {
        durationHistory: null,
        placementPlan: null,
        workerCount: null
    };
    const { placementPlan, workerCount } = planningFacts;
    const orderedCases = orderedCollectedCases(input, placementPlan, shardHasher);

    return {
        benchmarkPlacement: placementResolution === null
            ? await benchmarkPlacementForCases(input, orderedCases)
            : placementResolution.benchmarkPlacement,
        durationHistory: planningFacts.durationHistory,
        orderedCases,
        placementPlan,
        scheduling: resolvedScheduling(input, orderedCases),
        workerCount
    };
}
