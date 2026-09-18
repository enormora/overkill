import type { RunnerError } from '../engine/run-result.ts';
import {
    collectedRunCaseFactsFromEntries,
    collectedRunPlanFromEntries
} from './collected-run-plan.ts';
import { createCollectedExecutionPlan } from './run-collected-planning.ts';
import {
    createRunFacts
} from './run-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertCollectedRunPlanCasesMatchProfilePolicy,
    assertCollectedRunPlanHasCases,
    assertCollectedRunPlanMatchesTestFamily,
    selectedCollectedRunPlan
} from './run-selection.ts';
import {
    freezeValue,
    resolveRunReporters
} from './run-support.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunCommand,
    RunConfig,
    RunProfileConfig,
    RunRequest
} from './run-types.ts';
import type { WorkerPoolPlacementResolutionInput } from './worker-pool-placement-planning.ts';

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

async function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): Promise<ResolvedRun> {
    assertCollectedRunPlanMatchesTestFamily(input.collectedPlan, input.profile.testFamily);
    assertCollectedRunPlanCasesMatchProfilePolicy(input.collectedPlan, input.profile);

    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const { durationHistory, orderedCases, placementPlan } = await createCollectedExecutionPlan(input);
    const plannedCollectedPlan = collectedRunPlanFromEntries(input.collectedPlan, orderedCases);
    const facts = freezeValue(createRunFacts({
        cases: collectedRunCaseFactsFromEntries(orderedCases, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies: input.dependencies,
        durationHistory,
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
