import { resolveFamilyRun, disposeResolvedFamily } from './family-profile-run.ts';
import { assertReplaySelection } from './run-support.ts';
import { recordedRunPlan } from './recorded-run-plan.ts';
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
    source: LocalRunCollectionSource
): Promise<ResolvedRun> {
    const { testPlan, preparation } = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'enabled',
        dependencies,
        files: input.files,
        profile: input.profile,
        projectRoot: input.projectRoot,
        source
    });
    return await resolveFamilyRun(preparation, async function selectLocalPlan() {
        const cases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);
        if (cases === null && input.request.lastFailed) {
            return createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, testPlan);
        }
        return await createShardedLocalResolvedRunFromTestPlan(
            command,
            dependencies,
            input,
            selectedTestPlan(testPlan, input.request.selection)
        );
    });
}

export async function createLocalRunOrEmptySelectionResultFromInput(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    source: LocalRunCollectionSource
): Promise<
    { readonly replayPlan: CollectedRunPlan; readonly facts: RunFacts; readonly run: ResolvedRun | RunResult; }
> {
    if (input.profile.execution.processModel !== 'in-process') {
        throw new Error('Expected in-process profile.');
    }
    const { testPlan, preparation } = await createLocalTestPlan({
        command,
        definitionLocationCapture: 'disabled',
        dependencies,
        files: input.files,
        profile: input.profile,
        projectRoot: input.projectRoot,
        source
    });
    const run = await resolveFamilyRun(preparation, async function selectLocalPlan() {
        const cases = selectedNonEmptyTestPlanCases(testPlan, input.request.selection);
        assertReplaySelection(command, cases !== null);
        return cases === null
            ? createEmptyShardResolvedRunFromTestPlan(command, dependencies, input, testPlan)
            : await createShardedLocalResolvedRunFromTestPlan(command, dependencies, input, { ...testPlan, cases });
    });
    return {
        replayPlan: recordedRunPlan(run),
        facts: run.facts,
        run: selectedNonEmptyTestPlanCases(testPlan, input.request.selection) === null
            ? createEmptySelectionResult(testPlan, dependencies)
            : run
    };
}

export async function inspectLocalResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    source: LocalRunCollectionSource
): Promise<ResolvedRun> {
    const run = await createLocalResolvedRun(command, dependencies, input, source);
    await disposeResolvedFamily(run);
    return run;
}
