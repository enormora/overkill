import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    collectedRunCaseEntries,
    collectedRunCaseFactsFromEntries,
    collectedRunPlanFromEntries,
    collectedRunPlanFromTestPlanCases,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import {
    createRunFacts
} from './run-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    createRunShardHasher,
    shardCollectedRunPlanCases
} from './run-sharding.ts';
import {
    assertCollectedRunPlanHasCases,
    assertCollectedRunPlanMatchesTestFamily,
    assertCollectedRunPlanCasesMatchProfilePolicy,
    orderedRunItems,
    selectedCollectedRunPlan
} from './run-selection.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolution,
    type WorkerPoolPlacementResolutionInput
} from './worker-pool-placement-planning.ts';
import {
    freezeValue,
    resolveRunReporters
} from './run-support.ts';
import type {
    ResolvedRun,
    RunCommand,
    RunConfig,
    CollectedRunPlan,
    RunProfileConfig,
    RunRequest,
    RunWorkerPoolAssignmentPolicy
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type CollectedPlanKind = 'supervised' | 'worker-pool';
export type CollectionDurationHistoryIndex = WorkerPoolPlacementResolutionInput['durationHistoryIndex'];

type RunCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type CollectedResolvedRunInput = {
    readonly allowEmptySelection: boolean;
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly collectedPlan: CollectedRunPlan;
    readonly command: RunCommand;
    readonly config: RunConfig;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly engine: RunCommand['engine'];
    readonly files: ResolvedRunInput['files'];
    readonly planKind: CollectedPlanKind;
    readonly profile: RunProfileConfig;
    readonly projectRoot: string;
    readonly request: RunRequest;
};

export type CollectionResolvedRunInput = {
    readonly allowEmptySelection: boolean;
    readonly collection: RunCollection;
    readonly command: RunCommand;
    readonly config: RunConfig;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly engine: RunCommand['engine'];
    readonly files: ResolvedRunInput['files'];
    readonly planKind: CollectedPlanKind;
    readonly profile: RunProfileConfig;
    readonly projectRoot: string;
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

function createPlacementResolution(
    input: CollectedResolvedRunInput,
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
        nowMilliseconds: input.dependencies.wallClock.currentTimestampInMilliseconds,
        order: input.request.order,
        seed: input.request.seed,
        selectedPlan: input.collectedPlan,
        scheduling: input.profile.execution.scheduling,
        shard: input.request.shard,
        shardHasher,
        workDistribution: workDistribution(input.profile),
        workerLifecycle: workerLifecycle(input.profile)
    });
}

function orderedCollectedCases(
    input: CollectedResolvedRunInput,
    placementPlan: WorkerPoolPlacementResolution['placementPlan'] | null,
    shardHasher: Awaited<ReturnType<typeof createRunShardHasher>>
): ReturnType<typeof collectedRunCaseEntries> {
    return placementPlan === null
        ? orderedRunItems(
            shardCollectedRunPlanCases(input.collectedPlan, input.request.shard, shardHasher),
            input.request.order,
            input.request.seed
        )
        : collectedRunCaseEntriesFromWorkUnits(input.collectedPlan, placementPlan.units);
}

async function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): Promise<ResolvedRun> {
    assertCollectedRunPlanMatchesTestFamily(input.collectedPlan, input.profile.testFamily);
    assertCollectedRunPlanCasesMatchProfilePolicy(input.collectedPlan, input.profile);

    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const shardHasher = await createRunShardHasher(input.request.shard);
    const placementResolution = createPlacementResolution(input, shardHasher);
    const placementPlan = placementResolution?.placementPlan ?? null;
    const orderedCases = orderedCollectedCases(input, placementPlan, shardHasher);
    const plannedCollectedPlan = collectedRunPlanFromEntries(input.collectedPlan, orderedCases);
    const facts = freezeValue(createRunFacts({
        cases: collectedRunCaseFactsFromEntries(orderedCases, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies: input.dependencies,
        durationHistory: placementResolution?.durationHistory ?? null,
        engine: input.engine,
        placementPlan,
        projectRoot: input.projectRoot,
        request: input.request
    }));

    return freezeValue({
        collectionRunnerErrors: input.collectionRunnerErrors,
        config: input.config,
        cwd: input.command.cwd,
        engine: input.engine,
        facts,
        plan: {
            collectedPlan: plannedCollectedPlan,
            kind: input.planKind
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    });
}

export async function createResolvedRunFromCollection(input: CollectionResolvedRunInput): Promise<ResolvedRun> {
    const collectedPlan = selectedCollectedRunPlan(input.collection.collectedPlan, input.request.selection);

    return await createResolvedRunFromCollectedPlan({
        ...input,
        collectionRunnerErrors: freezeValue(Array.from(input.collection.runnerErrors)),
        collectedPlan: freezeValue(collectedPlan)
    });
}

export function createEmptySelectionResult(
    testPlan: TestPlan,
    dependencies: RunOrchestratorDependencies
): RunResult {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;

    return freezeValue(createRunResultFromCollectedPlan(
        collectedRunPlanFromTestPlanCases(testPlan, []),
        [],
        [],
        {
            planStatus: 'empty-selection',
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    ));
}
