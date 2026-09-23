import type { TestPlan } from '../engine/test-plan.ts';
import {
    createRunFacts,
    runCaseFactsFromTestPlan
} from './run-facts.ts';
import {
    createRunResultFromCollectedPlan,
    collectedRunPlanFromTestPlanCases
} from './collected-run-plan.ts';
import {
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import { createLocalTestPlan } from './run-local-test-plan.ts';
import { shardedLocalCases } from './run-local-sharding.ts';
import {
    orderedTestPlan,
    assertTestPlanMatchesTestFamily,
    assertTestPlanCasesMatchProfilePolicy,
    selectedNonEmptyTestPlanCases,
    selectedTestPlan
} from './run-selection.ts';
import {
    freezeValue,
    resolveRunReporters
} from './run-support.ts';
import type {
    ResolvedRun,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function fileSetForDiscoveredFiles(files: ResolvedRunInput['files']): (file: string | null) => string | null {
    const fileSets = new Map(files.map(function toFileSetEntry(file) {
        return [ file.file, file.fileSet ];
    }));

    return function fileSetForFile(file) {
        return file === null ? null : fileSets.get(file) ?? null;
    };
}

function createLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    plannedTestPlan: Awaited<ReturnType<typeof createLocalTestPlan>>
): ResolvedRun {
    assertTestPlanMatchesTestFamily(plannedTestPlan, input.profile.testFamily);
    assertTestPlanCasesMatchProfilePolicy(plannedTestPlan, input.profile);

    const facts = freezeValue(createRunFacts({
        cases: runCaseFactsFromTestPlan(plannedTestPlan, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies,
        durationHistory: null,
        engine: input.engine,
        placementPlan: null,
        projectRoot: input.projectRoot,
        request: input.request
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

function createEmptySelectionResult(
    testPlan: TestPlan,
    dependencies: RunOrchestratorDependencies
): RunResult {
    const startedAtMicroseconds = dependencies.wallClock.currentMonotonicMicroseconds;

    return freezeValue(createRunResultFromCollectedPlan(
        collectedRunPlanFromTestPlanCases(testPlan, []),
        [],
        [],
        {
            completedAtMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds,
            planStatus: 'empty-selection',
            resourceUsage: null,
            startedAtMicroseconds,
            testExecutionWallTimeMicroseconds: 0
        }
    ));
}

function createEmptyShardResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    selectedPlan: TestPlan
): ResolvedRun {
    const collectedPlan = collectedRunPlanFromTestPlanCases(selectedPlan, []);
    const facts = freezeValue(createRunFacts({
        cases: [],
        config: input.config,
        dependencies,
        durationHistory: null,
        engine: input.engine,
        placementPlan: null,
        projectRoot: input.projectRoot,
        request: input.request
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

async function createShardedLocalResolvedRunFromTestPlan(
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

export async function createLocalResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const testPlan = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'enabled',
        dependencies,
        files: input.files,
        profile: input.profile
    });
    const selectedPlan = selectedTestPlan(testPlan, input.request.selection);

    return await createShardedLocalResolvedRunFromTestPlan(
        command,
        dependencies,
        input,
        selectedPlan
    );
}

export async function createLocalRunOrEmptySelectionResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRun | RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'in-process') {
        throw new Error('Expected in-process profile.');
    }

    const testPlan = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'disabled',
        dependencies,
        files: input.files,
        profile: input.profile
    });
    const plannedCases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);

    if (plannedCases === null) {
        return createEmptySelectionResult(testPlan, dependencies);
    }

    return await createShardedLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases: plannedCases
    });
}
