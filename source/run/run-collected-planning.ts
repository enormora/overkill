import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    createRunShardHasher,
    shardCollectedRunPlanCases
} from './run-sharding.ts';
import {
    orderedRunItems
} from './run-selection.ts';
import type {
    CollectedRunPlan,
    RunProfileConfig,
    RunRequest,
    RunScheduling,
    RunWorkerCountFacts,
    RunWorkerPoolAssignmentPolicy
} from './run-types.ts';
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

type CollectedPlanKind = 'supervised' | 'worker-pool';

type CollectedExecutionPlanInput = {
    readonly collectedPlan: CollectedRunPlan;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: WorkerPoolPlacementResolutionInput['durationHistoryIndex'];
    readonly files: ResolvedRunInput['files'];
    readonly planKind: CollectedPlanKind;
    readonly profile: RunProfileConfig;
    readonly request: RunRequest;
};

type CollectedExecutionPlan = {
    readonly durationHistory: WorkerPoolPlacementResolution['durationHistory'] | null;
    readonly orderedCases: ReturnType<typeof shardCollectedRunPlanCases>;
    readonly placementPlan: WorkerPoolPlacementResolution['placementPlan'] | null;
    readonly scheduling: RunScheduling;
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

function workerPoolAssignmentPolicy(profile: RunProfileConfig): RunWorkerPoolAssignmentPolicy {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.assignmentPolicy
        : 'case-count-balanced';
}

function workDistribution(profile: RunProfileConfig): WorkerPoolPlacementResolutionInput['workDistribution'] {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workDistribution
        : { mode: 'file' };
}

function workerLifecycle(profile: RunProfileConfig): WorkerPoolPlacementResolutionInput['workerLifecycle'] {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workerLifecycle
        : 'reuse';
}

function profileMaximumWorkers(profile: RunProfileConfig): number | null {
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
): RunScheduling {
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
