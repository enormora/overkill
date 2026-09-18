import { workIdentityKey } from '../engine/identity.ts';
import {
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    PlacementPlan,
    RunOrder,
    RunSeed,
    RunShard,
    RunScheduling,
    RunWorkDistribution,
    RunWorkerPoolAssignmentPolicy,
    RunWorkerLifecycle
} from './run-types.ts';
import {
    selectDurationHistoryPlacement,
    type DurationHistoryIndex,
    type DurationHistoryPlacement
} from './duration-history.ts';
import {
    workUnitsFromCollectedPlan
} from './work-unit-planning.ts';
import type { RunShardHasher } from './run-sharding.ts';
import {
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

const coldStartMilliseconds = 0;

type WorkerPoolPlacementShardInput = {
    readonly shard?: RunShard;
    readonly shardHasher?: RunShardHasher | null;
};

type WorkerPoolPlacementBaseInput = {
    readonly assignmentPolicy: RunWorkerPoolAssignmentPolicy;
    readonly availableParallelism: number;
    readonly fileSetForFile: (file: string) => string | null;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
    readonly scheduling: RunScheduling;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type WorkerPoolPlacementPlanInput = WorkerPoolPlacementBaseInput & WorkerPoolPlacementShardInput;

export type WorkerPoolPlacementResolutionInput = WorkerPoolPlacementPlanInput & {
    readonly durationHistoryIndex: DurationHistoryIndex | null;
    readonly nowMilliseconds: number;
};

export type WorkerPoolPlacementResolution = {
    readonly durationHistory: DurationHistoryPlacement['facts'];
    readonly placementPlan: PlacementPlan;
};

function collectedEntriesByWorkKey(
    collectedPlan: CollectedRunPlan
): ReadonlyMap<string, ReturnType<typeof collectedRunCaseEntries>[number]> {
    return new Map(
        collectedRunCaseEntries(collectedPlan).map(function toEntry(entry) {
            return [ workIdentityKey(entry.workId), entry ];
        })
    );
}

export function collectedRunCaseEntriesFromWorkUnits(
    collectedPlan: CollectedRunPlan,
    units: PlacementPlan['units']
): ReturnType<typeof collectedRunCaseEntries> {
    const entries = collectedEntriesByWorkKey(collectedPlan);

    return units.flatMap(function toRunCaseEntries(unit) {
        return unit.work.map(function toRunCaseEntry(work) {
            const entry = entries.get(workIdentityKey(work));

            if (entry === undefined) {
                throw new Error('Placement plan referenced an unknown collected case.');
            }

            return entry;
        });
    });
}

export function createWorkerPoolPlacementResolution(
    input: WorkerPoolPlacementResolutionInput
): WorkerPoolPlacementResolution {
    const units = workUnitsFromCollectedPlan(input);
    const durationHistory = input.assignmentPolicy === 'duration-history-balanced'
        ? selectDurationHistoryPlacement(units, input.durationHistoryIndex, input.nowMilliseconds)
        : { facts: null, unitDuration: null };
    const lanes = workerPoolLanes({
        assignmentPolicy: input.assignmentPolicy,
        availableParallelism: input.availableParallelism,
        units
    });

    return {
        durationHistory: durationHistory.facts,
        placementPlan: {
            assignments: workerPoolPlacementAssignments(
                units,
                lanes,
                input.assignmentPolicy,
                durationHistory.unitDuration
            ),
            lanes,
            units
        }
    };
}

export function createWorkerPoolPlacementPlan(input: WorkerPoolPlacementPlanInput): PlacementPlan {
    return createWorkerPoolPlacementResolution({
        ...input,
        durationHistoryIndex: null,
        nowMilliseconds: coldStartMilliseconds
    })
        .placementPlan;
}
