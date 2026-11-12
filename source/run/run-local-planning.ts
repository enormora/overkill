import {
    assertReplaySelection,
    propertyReplayContext,
    freezeValue,
    resolveRunReporters
} from './run-support.ts';
import { resolveRunScheduling } from './run-profile-facts.ts';
import { createRunFacts, resolveRunDiagnostics } from './run-facts.ts';
import { runCaseFactsFromTestPlan } from './run-case-facts.ts';
import { createRunResultFromCollectedPlan, collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { planTestSelection } from './test-plan-selection.ts';
import {
    assertTestPlanMatchesTestFamily,
    assertTestPlanCasesMatchProfilePolicy
} from './run-selection.ts';
import type { ResolvedRun, RunCommand, RunFacts } from './run-types.ts';
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
    assertTestPlanMatchesTestFamily(plannedTestPlan, input.profile);
    assertTestPlanCasesMatchProfilePolicy(plannedTestPlan, input.profile);

    const facts = freezeValue({
        ...propertyReplayContext(command),
        ...createRunFacts({
            hostProcess: null,
            benchmarkHost: input.benchmarkHost,
            benchmarkCalibration: input.benchmarkCalibration,
            benchmarkNormalization: input.benchmarkNormalization,
            benchmarkPlacement: null,
            selectedIdentities: plannedTestPlan.cases.map(function identity(entry) {
                return entry.workId;
            }),
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

    return freezeValue(resolveRunDiagnostics({
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

type EmptyShardSelection = {
    readonly plan: TestPlan;
    readonly identities: NonNullable<RunFacts['reproducibility']['selectedIdentities']>;
};

export function createEmptyShardResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    selection: EmptyShardSelection
): ResolvedRun {
    const selectedPlan = selection.plan;
    const collectedPlan = collectedRunPlanFromTestPlanCases(selectedPlan, []);
    const baseFacts = createRunFacts({
        hostProcess: null,
        benchmarkHost: input.benchmarkHost,
        benchmarkCalibration: input.benchmarkCalibration,
        benchmarkNormalization: input.benchmarkNormalization,
        benchmarkPlacement: null,
        selectedIdentities: selection.identities,
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
    });
    const facts = freezeValue(baseFacts);

    return freezeValue(resolveRunDiagnostics({
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
        return createEmptyShardResolvedRunFromTestPlan(
            command,
            dependencies,
            input,
            {
                plan: selectedPlan,
                identities: selectedPlan.cases.map(function identity(entry) {
                    return entry.workId;
                })
            }
        );
    }
    const resolved = createLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...selection.testPlan,
        discoveredCases: selectedPlan.discoveredCases
    });
    return freezeValue({
        ...resolved,
        facts: {
            ...resolved.facts,
            reproducibility: {
                ...resolved.facts.reproducibility,
                selectedIdentities: selectedPlan.cases.map(function identity(entry) {
                    return entry.workId;
                })
            }
        }
    });
}
