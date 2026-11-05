import { recordedRunPlan } from './recorded-run-plan.ts';
import { collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { createLocalTestPlan, type LocalTestPlanInput } from './run-local-test-plan.ts';
import { selectedNonEmptyTestPlanCases, selectedTestPlan } from './run-selection.ts';
import {
    createEmptySelectionResult,
    createEmptyShardResolvedRunFromTestPlan,
    createShardedLocalResolvedRunFromTestPlan
} from './run-local-planning.ts';
import type { ResolvedRun, RunCommand, RunFacts, CollectedRunPlan } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type LocalRunCollectionSource = LocalTestPlanInput['source'];
type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

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
    const cases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);
    if (cases === null && input.request.lastFailed) {
        return createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, testPlan);
    }
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
): Promise<
    { readonly replayPlan: CollectedRunPlan; readonly facts: RunFacts; readonly run: ResolvedRun | RunResult; }
> {
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

        return {
            replayPlan: collectedRunPlanFromTestPlanCases(testPlan, []),
            facts: resolvedRun.facts,
            run: createEmptySelectionResult(testPlan, dependencies)
        };
    }

    const run = await createShardedLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases: plannedCases
    });

    return { replayPlan: recordedRunPlan(run), facts: run.facts, run };
}
