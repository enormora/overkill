import type { ResolvedRunInput } from './run-input-resolution.ts';
import { emptyWorkUnitResourceConstraints, type RunFacts, type RunRequest } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { CollectedRunCaseEntry } from './collected-run-plan.ts';
import type { RunShardHasher } from './run-sharding.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolutionInput,
    type WorkerPoolPlacementPlanInput
} from './worker-pool-placement-planning.ts';
import { workUnitsFromCollectedPlan } from './work-unit-planning.ts';

type ProfileConfig = ResolvedRunInput['profile'];
type WorkerPoolAssignmentPolicy = WorkerPoolPlacementResolutionInput['assignmentPolicy'];
type WorkDistribution = WorkerPoolPlacementPlanInput['workDistribution'];
type WorkerLifecycle = WorkerPoolPlacementPlanInput['workerLifecycle'];
type BenchmarkPlacementFacts = NonNullable<RunFacts['benchmarkPlacement']>;

type CollectedPlanKind = 'supervised' | 'worker-pool';

export type CollectedExecutionPlanInput = {
    readonly benchmarkHost: ResolvedRunInput['benchmarkHost'];
    readonly collectedPlan: WorkerPoolPlacementPlanInput['selectedPlan'];
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: WorkerPoolPlacementResolutionInput['durationHistoryIndex'];
    readonly files: ResolvedRunInput['files'];
    readonly planKind: CollectedPlanKind;
    readonly profile: ProfileConfig;
    readonly request: RunRequest;
};

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

function workerPoolAssignmentPolicy(profile: ProfileConfig): WorkerPoolAssignmentPolicy {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.assignmentPolicy
        : 'case-count-balanced';
}

function workDistribution(profile: ProfileConfig): WorkDistribution {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workDistribution
        : { mode: 'file' };
}

function workerLifecycle(profile: ProfileConfig): WorkerLifecycle {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.workerLifecycle
        : 'reuse';
}

function profileMaximumWorkers(profile: ProfileConfig): number | null {
    return profile.execution.processModel === 'worker-pool'
        ? profile.execution.maxWorkers
        : null;
}

function selectedBenchmarkDefinition(entry: CollectedRunCaseEntry): CollectedRunCaseEntry['testCase']['benchmark'] {
    const summary = entry.testCase.benchmark;
    const workload = entry.workId.workload?.name;
    if (summary === null || workload === undefined) {
        return summary;
    }
    const budgets = summary.budgets[workload];
    return budgets === undefined ? null : { ...summary, budgets: { [workload]: budgets } };
}

export async function benchmarkPlacementForCases(
    input: CollectedExecutionPlanInput,
    entries: readonly CollectedRunCaseEntry[]
): Promise<BenchmarkPlacementFacts | null> {
    if (input.profile.testFamily !== 'benchmark') {
        return null;
    }
    const { resolveBenchmarkPlacement } = await import('./benchmark-placement.ts');
    return resolveBenchmarkPlacement({
        definitions: entries.map(selectedBenchmarkDefinition),
        host: input.benchmarkHost,
        processModel: input.profile.execution.processModel
    });
}

export async function createPlacementResolution(
    input: CollectedExecutionPlanInput,
    shardHasher: RunShardHasher | null
): Promise<WorkerPoolPlacementResolution & { readonly benchmarkPlacement: BenchmarkPlacementFacts | null; } | null> {
    if (input.planKind !== 'worker-pool') {
        return null;
    }
    const units = workUnitsFromCollectedPlan({
        runConstraints: emptyWorkUnitResourceConstraints,
        fileSetForFile: fileSetForDiscoveredFiles(input.files),
        order: input.request.order,
        seed: input.request.seed,
        selectedPlan: input.collectedPlan,
        shard: input.request.shard,
        shardHasher,
        scheduling: input.profile.execution.scheduling,
        workDistribution: workDistribution(input.profile),
        workerLifecycle: workerLifecycle(input.profile)
    });
    const entries = collectedRunCaseEntriesFromWorkUnits(input.collectedPlan, units);
    const benchmarkPlacement = await benchmarkPlacementForCases(input, entries);
    return {
        ...createWorkerPoolPlacementResolution({
            units,
            maximumWorkers: benchmarkPlacement?.maximumWorkers ?? null,
            assignmentPolicy: workerPoolAssignmentPolicy(input.profile),
            availableParallelism: input.dependencies.availableParallelism,
            durationHistoryIndex: input.durationHistoryIndex,
            nowMilliseconds: input.dependencies.wallClock.currentUnixEpochMilliseconds,
            profileMaximumWorkers: profileMaximumWorkers(input.profile),
            requestedWorkers: input.request.workers,
            selectedPlan: input.collectedPlan
        }),
        benchmarkPlacement
    };
}
