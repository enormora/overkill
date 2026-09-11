import {
    collectedRunPlanFromTestPlanCases
} from './collected-run-plan.ts';
import {
    createRunFacts,
    runCaseFactsFromTestPlan
} from './run-facts.ts';
import {
    createEmptySelectionResult
} from './run-collected-resolution.ts';
import {
    assertMicrotestControlCaptureSupported,
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import { createLocalTestPlan } from './run-local-test-plan.ts';
import {
    orderedRunCases,
    orderedTestPlan,
    assertTestPlanMatchesTestFamily,
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
    assertMicrotestControlCaptureSupported(
        input.profile,
        collectedRunPlanFromTestPlanCases(plannedTestPlan, plannedTestPlan.cases)
    );

    const facts = freezeValue(createRunFacts({
        cases: runCaseFactsFromTestPlan(plannedTestPlan, fileSetForDiscoveredFiles(input.files)),
        config: input.config,
        dependencies,
        engine: input.engine,
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

export async function createLocalResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const testPlan = await createLocalTestPlan(command, input.profile, input.files, dependencies);
    const selectedPlan = selectedTestPlan(testPlan, input.request.selection);

    return createLocalResolvedRunFromTestPlan(
        command,
        dependencies,
        input,
        orderedTestPlan(selectedPlan, input.request.order, input.request.seed)
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

    const cases = orderedRunCases(plannedCases, input.request.order, input.request.seed);

    return createLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases
    });
}
