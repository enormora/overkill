import { resolveSelectedFamilyFacts } from './selected-family-facts.ts';
import {
    assertReplaySelection,
    propertyReplayContext,
    hasPropertyReplay,
    freezeValue,
    resolveRunReporters
} from './run-support.ts';
import type { CollectedExecutionPlanInput } from './collected-placement.ts';
import {
    collectedRunPlanFromEntries,
    collectedRunCaseEntries,
    type CollectedRunCaseEntry
} from './collected-run-plan.ts';
import { collectedRunCaseFactsFromEntries } from './run-case-facts.ts';
import { createCollectedExecutionPlan } from './run-collected-planning.ts';
import { createRunFacts, resolveRunDiagnostics } from './run-facts.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    assertCollectedRunPlanHasCases,
    selectedCollectedRunPlan,
    assertCollectedRunPlanCasesMatchProfilePolicy,
    assertCollectedRunPlanMatchesTestFamily
} from './run-selection.ts';
import type { CollectedRunPlan, ResolvedRun, RunCommand } from './run-types.ts';

type RunOrchestratorDependencies = CollectedExecutionPlanInput['dependencies'];

type RunnerError = ResolvedRun['collectionRunnerErrors'][number];

type CollectedPlanKind = 'supervised' | 'worker-pool';
export type CollectionDurationHistoryIndex = CollectedExecutionPlanInput['durationHistoryIndex'];

type RunCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type CollectedResolvedRunInput = ResolvedRunInput & {
    readonly allowEmptySelection: boolean;
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly collectedPlan: CollectedRunPlan;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly planKind: CollectedPlanKind;
};

export type CollectionResolvedRunInput = ResolvedRunInput & {
    readonly allowEmptySelection: boolean;
    readonly collection: RunCollection;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly durationHistoryIndex: CollectionDurationHistoryIndex;
    readonly planKind: CollectedPlanKind;
};

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

function selectedNormalization(
    input: CollectedResolvedRunInput,
    cases: readonly CollectedRunCaseEntry[]
): ResolvedRunInput['benchmarkNormalization'] {
    const normalized = cases.some(function normalizedCase(entry) {
        return Object.keys(entry.testCase.benchmark?.normalization ?? {}).length > 0;
    });
    return input.benchmarkPurpose === 'capture' || normalized ? input.benchmarkNormalization : null;
}
function hasValidReplaySelection(command: RunCommand, plan: CollectedRunPlan): boolean {
    if (!hasPropertyReplay(command)) {
        return true;
    }
    const cases = collectedRunCaseEntries(plan);
    const [ entry ] = cases;
    if (entry === undefined || cases.length !== 1) {
        return false;
    }
    const { testCase } = entry;
    return testCase.skipReason === null && testCase.property !== null;
}

async function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): Promise<ResolvedRun> {
    assertReplaySelection(input.command, hasValidReplaySelection(input.command, input.collectedPlan));
    assertCollectedRunPlanMatchesTestFamily(input.collectedPlan, input.profile);
    assertCollectedRunPlanCasesMatchProfilePolicy(input.collectedPlan, input.profile);

    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const {
        benchmarkPlacement,
        durationHistory,
        hostProcess,
        orderedCases,
        placementPlan,
        scheduling,
        workerCount,
        recordedFacts
    } = await createCollectedExecutionPlan(input);
    const plannedCollectedPlan = collectedRunPlanFromEntries(input.collectedPlan, orderedCases);
    const facts = freezeValue({
        ...propertyReplayContext(input.command),
        ...createRunFacts({
            hostProcess,
            benchmarkHost: input.benchmarkHost,
            benchmarkPlacement,
            benchmarkCalibration: input.benchmarkCalibration,
            benchmarkNormalization: selectedNormalization(input, orderedCases),
            ...recordedFacts,
            selectedIdentities: collectedRunCaseEntries(input.collectedPlan).map(function identity(entry) {
                return entry.workId;
            }),
            cases: collectedRunCaseFactsFromEntries(orderedCases, fileSetForDiscoveredFiles(input.files)),
            config: input.config,
            dependencies: input.dependencies,
            durationHistory,
            engine: input.engine,
            placementPlan,
            projectRoot: input.projectRoot,
            request: input.request,
            scheduling,
            workerCount
        }),
        ...input.collectedPlan.family === null ? {} : { family: input.collectedPlan.family.facts },
        ...recordedFacts === null ? {} : { reproducibility: recordedFacts.reproducibility }
    });

    return freezeValue(resolveRunDiagnostics({
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
    }));
}

export async function createResolvedRunFromCollection(input: CollectionResolvedRunInput): Promise<ResolvedRun> {
    if (input.profile.testFamily === 'property') {
        assertCollectedRunPlanCasesMatchProfilePolicy(input.collection.collectedPlan, input.profile);
    }
    const collectedPlan = selectedCollectedRunPlan(input.collection.collectedPlan, input.request.selection);

    const run = await createResolvedRunFromCollectedPlan({
        ...input,
        collectionRunnerErrors: freezeValue(Array.from(input.collection.runnerErrors)),
        collectedPlan: freezeValue(collectedPlan)
    });
    return freezeValue(await resolveSelectedFamilyFacts(run, input));
}
