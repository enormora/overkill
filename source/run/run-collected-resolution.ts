import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    collectedRunCaseEntries,
    collectedRunCaseFactsFromEntries,
    collectedRunPlanFromTestPlanCases,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import {
    createRunFacts
} from './run-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    assertCollectedRunPlanHasCases,
    assertCollectedRunPlanMatchesTestFamily,
    assertCollectedRunPlanCasesMatchProfilePolicy,
    orderedRunItems,
    selectedCollectedRunPlan
} from './run-selection.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementPlan
} from './work-unit-planning.ts';
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

function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): ResolvedRun {
    assertCollectedRunPlanMatchesTestFamily(input.collectedPlan, input.profile.testFamily);
    assertCollectedRunPlanCasesMatchProfilePolicy(input.collectedPlan, input.profile);

    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const placementPlan = input.planKind === 'worker-pool'
        ? createWorkerPoolPlacementPlan({
            assignmentPolicy: workerPoolAssignmentPolicy(input.profile),
            availableParallelism: input.dependencies.availableParallelism,
            fileSetForFile: fileSetForDiscoveredFiles(input.files),
            order: input.request.order,
            seed: input.request.seed,
            selectedPlan: input.collectedPlan,
            scheduling: input.profile.execution.scheduling,
            workDistribution: input.profile.execution.processModel === 'worker-pool'
                ? input.profile.execution.workDistribution
                : { mode: 'file' },
            workerLifecycle: input.profile.execution.processModel === 'worker-pool'
                ? input.profile.execution.workerLifecycle
                : 'reuse'
        })
        : null;
    const orderedCases = placementPlan === null
        ? orderedRunItems(
            collectedRunCaseEntries(input.collectedPlan),
            input.request.order,
            input.request.seed
        )
        : collectedRunCaseEntriesFromWorkUnits(input.collectedPlan, placementPlan.units);
    const facts = freezeValue(createRunFacts({
        cases: collectedRunCaseFactsFromEntries(orderedCases, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies: input.dependencies,
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
            collectedPlan: input.collectedPlan,
            kind: input.planKind
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    });
}

export function createResolvedRunFromCollection(input: CollectionResolvedRunInput): ResolvedRun {
    const collectedPlan = selectedCollectedRunPlan(input.collection.collectedPlan, input.request.selection);

    return createResolvedRunFromCollectedPlan({
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
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    ));
}
