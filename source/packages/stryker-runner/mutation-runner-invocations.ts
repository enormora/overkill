import {
    DryRunStatus,
    MutantRunStatus,
    type DryRunOptions,
    type DryRunResult,
    type MutantRunOptions,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import type { InvocationBudget, RunExecutionReply } from '../run/run.entry-point.ts';
import { mutationLifecycleInputSchema } from './mutation-lifecycle.ts';
import { mutantExecutionResult } from './mutation-results.ts';
import { dryMutationResult, type DryRunExpectation } from './dry-run-results.ts';
import type { ReadyMutationRunner } from './mutation-runner-initialization.ts';
import type { MutationBaseline } from './mutation-baseline.ts';
import { dryRunExpectation, resolveMutantInvocation } from './mutation-invocation-planning.ts';

type DryInvocationCompletion = {
    readonly input: Readonly<DryRunOptions>;
    readonly expectation: DryRunExpectation;
    readonly budget: InvocationBudget;
};

export type MutationRunnerInvocations = {
    readonly dry: (
        runner: ReadyMutationRunner,
        input: Readonly<DryRunOptions>,
        budget: InvocationBudget
    ) => Promise<DryRunResult>;
    readonly mutant: (
        runner: ReadyMutationRunner,
        input: Readonly<MutantRunOptions>,
        budget: InvocationBudget
    ) => Promise<MutantRunResult>;
};
export function createMutationRunnerInvocations(
    baseline: MutationBaseline,
    ignoreStatic: boolean
): MutationRunnerInvocations {
    async function completeDryInvocation(
        runner: ReadyMutationRunner,
        reply: RunExecutionReply,
        invocation: DryInvocationCompletion
    ): Promise<DryRunResult> {
        const { input, expectation, budget } = invocation;
        const coverage = input.coverageAnalysis;
        const result = dryMutationResult(runner.root, reply, coverage, expectation);
        if (result.status === DryRunStatus.Complete && !budget.expired()) {
            await baseline.publish(runner.client, reply, {
                coverageAnalysis: coverage,
                testFiles: expectation.testFiles,
                budget
            });
        }
        return result;
    }

    return {
        async dry(runner, input, budget) {
            const expectation = await dryRunExpectation(runner, baseline, input, budget);
            if (budget.expired()) {
                return { status: DryRunStatus.Timeout, reason: 'Campaign baseline delivery exceeded the deadline.' };
            }
            runner.execution.admitEnvironment('dry', false);
            const reply = await runner.execution.run(
                mutationLifecycleInputSchema.parse({
                    root: runner.root,
                    mode: 'dry',
                    activeMutant: null,
                    hitLimit: null,
                    baseline: expectation.baseline?.catalog ?? null,
                    selected: null,
                    disableBail: input.disableBail,
                    files: expectation.testFiles
                }),
                budget
            );
            return await completeDryInvocation(runner, reply, { input, expectation, budget });
        },
        async mutant(runner, input, budget) {
            const { campaign, mode, selected } = await resolveMutantInvocation(runner, baseline, {
                input,
                ignoreStatic,
                budget
            });
            if (budget.expired()) {
                return {
                    status: MutantRunStatus.Timeout,
                    reason: 'Campaign baseline delivery exceeded the invocation deadline.'
                };
            }
            runner.execution.admitEnvironment(mode, input.reloadEnvironment);
            const reply = await runner.execution.run(
                mutationLifecycleInputSchema.parse({
                    root: runner.root,
                    mode,
                    activeMutant: input.activeMutant.id,
                    hitLimit: input.hitLimit ?? null,
                    baseline: campaign.catalog,
                    selected,
                    disableBail: input.disableBail,
                    files: campaign.testFiles
                }),
                budget
            );
            return mutantExecutionResult(runner.root, reply, {
                kind: 'mutant',
                baseline: campaign,
                selected,
                disableBail: input.disableBail
            });
        }
    };
}
