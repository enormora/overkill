import type { TestPlan } from '../engine/test-plan.ts';
import { resolveRunScheduling } from './run-profile-facts.ts';
import { createRunFacts, runCaseFactsFromTestPlan } from './run-facts.ts';
import { createRunResultFromCollectedPlan, collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { shardedLocalCases } from './run-local-sharding.ts';
import {
    orderedTestPlan,
    assertTestPlanMatchesTestFamily,
    assertTestPlanCasesMatchProfilePolicy
} from './run-selection.ts';
import { freezeValue, resolveRunReporters } from './run-support.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

export function createLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    plannedTestPlan: TestPlan
): ResolvedRun {
    assertTestPlanMatchesTestFamily(plannedTestPlan, input.profile.testFamily);
    assertTestPlanCasesMatchProfilePolicy(plannedTestPlan, input.profile);

    const facts = freezeValue(createRunFacts({
        benchmarkHost: input.benchmarkHost,
        benchmarkCalibration: input.benchmarkCalibration,
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
    }));

    return freezeValue({
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
    });
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
        benchmarkHost: input.benchmarkHost,
        benchmarkCalibration: input.benchmarkCalibration,
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

    return freezeValue({
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
    });
}

export async function createShardedLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    selectedPlan: TestPlan
): Promise<ResolvedRun> {
    const plannedCases = await shardedLocalCases(selectedPlan, input);
    const firstCase = plannedCases[0];

    if (firstCase === undefined) {
        return createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, selectedPlan);
    }

    const orderedPlan = orderedTestPlan(
        { ...selectedPlan, cases: [ firstCase, ...plannedCases.slice(1) ] },
        input.request.order,
        input.request.seed
    );

    return createLocalResolvedRunFromTestPlan(command, dependencies, input, orderedPlan);
}
