import type { TestProfileConfig, Scheduling, WorkerPoolAssignmentPolicy } from '../config/types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    createRunShardHasher,
    shardCollectedRunPlanCases
} from './run-sharding.ts';
import {
    orderedRunItems
} from './run-ordering.ts';
import type { CollectedRunPlan, RunRequest, RunWorkerCountFacts } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolutionInput
} from './worker-pool-placement-planning.ts';
import {
    constrainedScheduling,
    workResourceConstraints
} from './work-unit-resource-constraints.ts';
import { collectedPlanCompatibilityConflicts } from './execution-plan-resolution.ts';
import { RunExecutionPlanError } from './run-errors.ts';

type CollectedPlanKind = 'supervised' | 'worker-pool';

type CollectedExecutionPlanInput = {
    readonly collectedPlan: CollectedRunPlan;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: WorkerPoolPlacementResolutionInput['durationHistoryIndex'];
    readonly files: ResolvedRunInput['files'];
    readonly planKind: CollectedPlanKind;
    readonly profile: TestProfileConfig;
    readonly request: RunRequest;
};

type CollectedExecutionPlan = {
    readonly durationHistory: WorkerPoolPlacementResolution['durationHistory'] | null;
    readonly orderedCases: ReturnType<typeof shardCollectedRunPlanCases>;
    readonly placementPlan: WorkerPoolPlacementResolution['placementPlan'] | null;
    readonly scheduling: Scheduling;
    readonly workerCount: RunWorkerCountFacts | null;
};

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

function workerPoolAssignmentPolicy(profile: TestProfileConfig): WorkerPoolAssignmentPolicy {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.assignmentPolicy
        : 'case-count-balanced';
}

function workDistribution(profile: TestProfileConfig): WorkerPoolPlacementResolutionInput['workDistribution'] {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workDistribution
        : { mode: 'file' };
}

function workerLifecycle(profile: TestProfileConfig): WorkerPoolPlacementResolutionInput['workerLifecycle'] {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workerLifecycle
        : 'reuse';
}

function profileMaximumWorkers(profile: TestProfileConfig): number | null {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.maxWorkers
        : null;
}

function createPlacementResolution(
    input: CollectedExecutionPlanInput,
    shardHasher: Awaited<ReturnType<typeof createRunShardHasher>>
): WorkerPoolPlacementResolution | null {
    if (input.planKind !== 'worker-pool') {
        return null;
    }

    return createWorkerPoolPlacementResolution({
        assignmentPolicy: workerPoolAssignmentPolicy(input.profile),
        availableParallelism: input.dependencies.availableParallelism,
        durationHistoryIndex: input.durationHistoryIndex,
        fileSetForFile: fileSetForDiscoveredFiles(input.files),
        nowMilliseconds: input.dependencies.wallClock.currentUnixEpochMilliseconds,
        order: input.request.order,
        profileMaximumWorkers: profileMaximumWorkers(input.profile),
        requestedWorkers: input.request.workers,
        seed: input.request.seed,
        selectedPlan: input.collectedPlan,
        shard: input.request.shard,
        shardHasher,
        scheduling: input.profile.execution.scheduling,
        workDistribution: workDistribution(input.profile),
        workerLifecycle: workerLifecycle(input.profile)
    });
}

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

    return constrainedScheduling(input.profile.execution.scheduling, constraints);
}

export async function createCollectedExecutionPlan(
    input: CollectedExecutionPlanInput
): Promise<CollectedExecutionPlan> {
    if (input.planKind === 'supervised') {
        const conflicts = collectedPlanCompatibilityConflicts(input.collectedPlan);

        if (conflicts.length > 0) {
            throw new RunExecutionPlanError(conflicts, undefined);
        }
    }

    const shardHasher = await createRunShardHasher(input.request.shard);
    const placementResolution = createPlacementResolution(input, shardHasher);
    const planningFacts = placementResolution ?? {
        durationHistory: null,
        placementPlan: null,
        workerCount: null
    };
    const { placementPlan, workerCount } = planningFacts;
    const orderedCases = orderedCollectedCases(input, placementPlan, shardHasher);

    return {
        durationHistory: planningFacts.durationHistory,
        orderedCases,
        placementPlan,
        scheduling: resolvedScheduling(input, orderedCases),
        workerCount
    };
}
