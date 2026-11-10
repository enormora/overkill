import { assertReplaySelection, propertyReplayContext, freezeValue, resolveRunReporters } from './run-support.ts';
import { resolveRunScheduling } from './run-profile-facts.ts';
import { createRunFacts, resolveAttachmentPersistence } from './run-facts.ts';
import { runCaseFactsFromTestPlan } from './run-case-facts.ts';
import { createRunResultFromCollectedPlan, collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { planTestSelection } from './test-plan-selection.ts';
import {
    assertTestPlanMatchesTestFamily,
    assertTestPlanCasesMatchProfilePolicy
} from './run-selection.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type TestPlan = Extract<ResolvedRun['plan'], { readonly kind: 'local'; }>['testPlan'];

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

function isExecutableProperty(testCase: TestPlan['cases'][number]): boolean {
    return testCase.execution.kind === 'body' && testCase.execution.bodyMode === 'property';
}

export function createLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    plannedTestPlan: TestPlan
): ResolvedRun {
    assertReplaySelection(
        command,
        plannedTestPlan.cases.length === 1 && isExecutableProperty(plannedTestPlan.cases[0])
    );
    assertTestPlanMatchesTestFamily(plannedTestPlan, input.profile.testFamily);
    assertTestPlanCasesMatchProfilePolicy(plannedTestPlan, input.profile);

    const facts = freezeValue({
        ...propertyReplayContext(command),
        ...createRunFacts({
            hostProcess: null,
            benchmarkHost: input.benchmarkHost,
            benchmarkCalibration: input.benchmarkCalibration,
            benchmarkNormalization: input.benchmarkNormalization,
            benchmarkPlacement: null,
            cases: runCaseFactsFromTestPlan(plannedTestPlan, fileSetForDiscoveredFiles(input.files)),
            config: input.config,
            dependencies,
            durationHistory: null,
            engine: input.engine,
            placementPlan: null,
            projectRoot: input.projectRoot,
            request: input.request,
            scheduling: resolveRunScheduling(input.request, input.profile),
            workerCount: null
        })
    });

    return freezeValue(resolveAttachmentPersistence({
        collectionRunnerErrors: [],
        config: input.config,
        cwd: command.cwd,
        engine: input.engine,
        facts,
        plan: {
            kind: 'local',
            testPlan: plannedTestPlan
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    }));
}

export function createEmptySelectionResult(
    testPlan: TestPlan,
    dependencies: RunOrchestratorDependencies
): RunResult {
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);

    return freezeValue(createRunResultFromCollectedPlan(
        collectedRunPlanFromTestPlanCases(testPlan, []),
        [],
        [],
        {
            completedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
            planStatus: 'empty-selection',
            processUsage: null,
            startedAtMicroseconds,
            testExecutionWallTimeMicroseconds: 0
        }
    ));
}

export function createEmptyShardResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    selectedPlan: TestPlan
): ResolvedRun {
    const collectedPlan = collectedRunPlanFromTestPlanCases(selectedPlan, []);
    const facts = freezeValue(createRunFacts({
        hostProcess: null,
        benchmarkHost: input.benchmarkHost,
        benchmarkCalibration: input.benchmarkCalibration,
        benchmarkNormalization: input.benchmarkNormalization,
        benchmarkPlacement: null,
        cases: [],
        config: input.config,
        dependencies,
        durationHistory: null,
        engine: input.engine,
        placementPlan: null,
        projectRoot: input.projectRoot,
        request: input.request,
        scheduling: resolveRunScheduling(input.request, input.profile),
        workerCount: null
    }));

    return freezeValue(resolveAttachmentPersistence({
        collectionRunnerErrors: [],
        config: input.config,
        cwd: command.cwd,
        engine: input.engine,
        facts,
        plan: {
            collectedPlan,
            kind: 'empty-shard'
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    }));
}

export async function createShardedLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    selectedPlan: TestPlan
): Promise<ResolvedRun> {
    const selection = await planTestSelection(
        { ...selectedPlan, discoveredCases: selectedPlan.cases },
        { ...input.request, selection: { kind: 'all' } }
    );
    if (selection.kind === 'empty-shard') {
        return createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, selectedPlan);
    }
    return createLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...selection.testPlan,
        discoveredCases: selectedPlan.discoveredCases
    });
}
