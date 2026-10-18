import { isDeepStrictEqual } from 'node:util';
import {
    DryRunStatus,
    MutantRunStatus,
    type DryRunOptions,
    type DryRunResult,
    type MutantRunOptions,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import type { RunExecutionReply } from '../run/run.entry-point.ts';
import { mutationLifecycleInputSchema } from './mutation-lifecycle.ts';
import { mutantExecutionResult } from './mutation-results.ts';
import { dryMutationResult, type DryRunExpectation } from './dry-run-results.ts';
import { planMutantInvocation, type MutantInvocationPlan } from './mutation-selection.ts';
import type { ReadyMutationRunner } from './mutation-runner-lifecycle.ts';
import type { MutationBaseline } from './mutation-baseline.ts';
import { mutationTestFiles, type CampaignBaseline } from './mutation-catalog.ts';

export type MutationRunnerInvocations = {
    readonly dry: (
        runner: ReadyMutationRunner,
        input: Readonly<DryRunOptions>,
        remaining: number
    ) => Promise<DryRunResult>;
    readonly mutant: (
        runner: ReadyMutationRunner,
        input: Readonly<MutantRunOptions>,
        remaining: number
    ) => Promise<MutantRunResult>;
};
async function dryRunExpectation(
    runner: ReadyMutationRunner,
    baseline: MutationBaseline,
    input: Readonly<DryRunOptions>
): Promise<DryRunExpectation> {
    const campaign = await baseline.read(runner.client);
    const testFiles = mutationTestFiles(runner.root, input.testFiles ?? null);
    if (
        campaign !== null && (!isDeepStrictEqual(testFiles, campaign.testFiles) ||
            input.coverageAnalysis !== campaign.coverageAnalysis)
    ) {
        throw new Error('Dry run conflicts with the original campaign selection or coverage mode.');
    }
    return { kind: 'dry', baseline: campaign, testFiles };
}

async function resolveMutantInvocation(
    runner: ReadyMutationRunner,
    baseline: MutationBaseline,
    input: Readonly<MutantRunOptions>,
    ignoreStatic: boolean
): Promise<MutantInvocationPlan & { readonly campaign: CampaignBaseline; }> {
    const campaign = await baseline.read(runner.client);
    if (campaign === null) {
        throw new Error('Campaign dry-run baseline is unavailable.');
    }
    return { campaign, ...planMutantInvocation({ root: runner.root, campaign, input, ignoreStatic }) };
}

export function createMutationRunnerInvocations(
    baseline: MutationBaseline,
    ignoreStatic: boolean
): MutationRunnerInvocations {
    async function completeDryInvocation(
        runner: ReadyMutationRunner,
        reply: RunExecutionReply,
        coverage: DryRunOptions['coverageAnalysis'],
        expectation: DryRunExpectation
    ): Promise<DryRunResult> {
        const result = dryMutationResult(runner.root, reply, coverage, expectation);
        if (result.status === DryRunStatus.Complete) {
            await baseline.publish(runner.client, reply, coverage, expectation.testFiles);
        }
        return result;
    }

    return {
        async dry(runner, input, remaining) {
            const started = performance.now();
            const expectation = await dryRunExpectation(runner, baseline, input);
            const budget = remaining - (performance.now() - started);
            if (budget <= 0) {
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
            return await completeDryInvocation(runner, reply, input.coverageAnalysis, expectation);
        },
        async mutant(runner, input, remaining) {
            const started = performance.now();
            const { campaign, mode, selected } = await resolveMutantInvocation(runner, baseline, input, ignoreStatic);
            const budget = remaining - (performance.now() - started);
            if (budget <= 0) {
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
