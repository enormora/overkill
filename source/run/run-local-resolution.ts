import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createLocalTestPlan, type LocalTestPlanInput } from './run-local-test-plan.ts';
import { selectedNonEmptyTestPlanCases, selectedTestPlan } from './run-selection.ts';
import {
    createEmptySelectionResult,
    createEmptyShardResolvedRunFromTestPlan,
    createShardedLocalResolvedRunFromTestPlan
} from './run-local-planning.ts';
import type { ResolvedRun, RunCommand, RunFacts } from './run-types.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type LocalRunCollectionSource = LocalTestPlanInput['source'];
type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

export async function createLocalResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    source: LocalTestPlanInput['source']
): Promise<ResolvedRun> {
    const testPlan = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'enabled',
        dependencies,
        files: input.files,
        profile: input.profile,
        source
    });
    const selectedPlan = selectedTestPlan(testPlan, input.request.selection);

    return await createShardedLocalResolvedRunFromTestPlan(
        command,
        dependencies,
        input,
        selectedPlan
    );
}

export async function createLocalRunOrEmptySelectionResultFromInput(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    source: LocalTestPlanInput['source']
): Promise<{ readonly facts: RunFacts; readonly run: ResolvedRun | RunResult; }> {
    if (input.profile.execution.processModel !== 'in-process') {
        throw new Error('Expected in-process profile.');
    }

    const testPlan = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'disabled',
        dependencies,
        files: input.files,
        profile: input.profile,
        source
    });
    const plannedCases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);

    if (plannedCases === null) {
        const resolvedRun = createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, testPlan);

        return { facts: resolvedRun.facts, run: createEmptySelectionResult(testPlan, dependencies) };
    }

    const run = await createShardedLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases: plannedCases
    });

    return { facts: run.facts, run };
}

export async function createLocalRunOrEmptySelectionResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    source: LocalTestPlanInput['source'],
    input: ResolvedRunInput
): Promise<ResolvedRun | RunResult> {
    const resolved = await createLocalRunOrEmptySelectionResultFromInput(command, dependencies, input, source);

    return resolved.run;
}
