import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import {
    createRunFacts,
    runCaseFactsFromTestPlan
} from './run-facts.ts';
import {
    collectedRunPlanFromTestPlanCases,
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import {
    createRunShardHasher,
    shardCollectedRunCaseEntries
} from './run-sharding.ts';
import {
    createEmptySelectionResult
} from './run-collected-resolution.ts';
import {
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import { createLocalTestPlan } from './run-local-test-plan.ts';
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

async function shardedLocalCases(
    testPlan: TestPlan,
    input: ResolvedRunInput
): Promise<readonly TestPlanCase[]> {
    const shardHasher = await createRunShardHasher(input.request.shard);
    const entries = shardCollectedRunCaseEntries(
        collectedRunCaseEntries(collectedRunPlanFromTestPlanCases(testPlan, testPlan.cases)),
        input.request.shard,
        shardHasher
    );
    const casesByKey = new Map(testPlan.cases.map(function toCaseEntry(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ];
    }));

    return entries.flatMap(function toTestCase(entry) {
        const testCase = casesByKey.get(workIdentityKey(entry.workId));

        return testCase === undefined ? [] : [ testCase ];
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
    const testPlan = await createLocalTestPlan(command, input.profile, input.files, dependencies);
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

    const testPlan = await createLocalTestPlan(command, input.profile, input.files, dependencies);
    const plannedCases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);

    if (plannedCases === null) {
        return createEmptySelectionResult(testPlan, dependencies);
    }

    return await createShardedLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases: plannedCases
    });
}
