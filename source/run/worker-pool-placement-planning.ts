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
    RunWorkerCountFacts,
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
    resolveWorkerCountCapacity,
    workerPoolLanesForCount,
    workerPoolPlacementAssignments,
    type WorkerPoolLaneInput
} from './worker-pool-lanes.ts';
import {
    createResourceOwnershipPlan,
    executionPlanCompatibilityConflicts
} from './execution-plan-resolution.ts';
import { RunExecutionPlanError, type RunExecutionPlanConflict } from './run-errors.ts';

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
    readonly profileMaximumWorkers: number | null;
    readonly requestedWorkers: number | null;
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
    readonly workerCount: RunWorkerCountFacts;
};

function assertCompatibleExecutionPlan(conflicts: readonly RunExecutionPlanConflict[]): void {
    if (conflicts.length > 0) {
        throw new RunExecutionPlanError(conflicts, undefined);
    }
}

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
    const laneInput: WorkerPoolLaneInput = {
        assignmentPolicy: input.assignmentPolicy,
        availableParallelism: input.availableParallelism,
        profileMaximum: input.profileMaximumWorkers,
        requestedWorkers: input.requestedWorkers,
        units
    };
    const workerCapacity = resolveWorkerCountCapacity(laneInput);
    const { workerCount } = workerCapacity;
    const conflicts = executionPlanCompatibilityConflicts({
        requiredLifecycleLanes: workerCapacity.requiredLanes,
        selectedPlan: input.selectedPlan,
        units,
        workerCount
    });

    assertCompatibleExecutionPlan(conflicts);

    const lanes = workerPoolLanesForCount(workerCount.resolved);
    const assignments = workerPoolPlacementAssignments(
        units,
        lanes,
        input.assignmentPolicy,
        durationHistory.unitDuration
    );

    return {
        durationHistory: durationHistory.facts,
        placementPlan: {
            assignments,
            lanes,
            resourceOwnership: createResourceOwnershipPlan({
                lanes,
                selectedPlan: input.selectedPlan,
                units
            }),
            units
        },
        workerCount
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
