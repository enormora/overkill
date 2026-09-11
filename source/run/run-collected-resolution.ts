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
import {
    assertMicrotestControlCaptureSupported,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import {
    assertCollectedRunPlanHasCases,
    assertCollectedRunPlanMatchesTestFamily,
    orderedRunCases,
    selectedCollectedRunPlan
} from './run-selection.ts';
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
    RunRequest
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

function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): ResolvedRun {
    assertCollectedRunPlanMatchesTestFamily(input.collectedPlan, input.profile.testFamily);
    assertMicrotestControlCaptureSupported(input.profile, input.collectedPlan);

    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const orderedCases = orderedRunCases(
        collectedRunCaseEntries(input.collectedPlan),
        input.request.order,
        input.request.seed
    );
    const facts = freezeValue(createRunFacts({
        cases: collectedRunCaseFactsFromEntries(orderedCases, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies: input.dependencies,
        engine: input.engine,
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
