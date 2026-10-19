import { isDeepStrictEqual } from 'node:util';
import type { DryRunOptions, MutantRunOptions } from '@stryker-mutator/api/test-runner';
import type { InvocationBudget } from '../run/run.entry-point.ts';
import type { ReadyMutationRunner } from './mutation-runner-initialization.ts';
import type { MutationBaseline } from './mutation-baseline.ts';
import { mutationTestFiles, type CampaignBaseline } from './mutation-catalog.ts';
import type { DryRunExpectation } from './dry-run-results.ts';
import { planMutantInvocation, type MutantInvocationPlan } from './mutation-selection.ts';

type MutantInvocation = {
    readonly input: Readonly<MutantRunOptions>;
    readonly ignoreStatic: boolean;
    readonly budget: InvocationBudget;
};

export async function dryRunExpectation(
    runner: ReadyMutationRunner,
    baseline: MutationBaseline,
    input: Readonly<DryRunOptions>,
    budget: InvocationBudget
): Promise<DryRunExpectation> {
    const campaign = await baseline.read(runner.client, budget);
    const testFiles = mutationTestFiles(runner.root, input.testFiles ?? null);
    if (
        campaign !== null && (!isDeepStrictEqual(testFiles, campaign.testFiles) ||
            input.coverageAnalysis !== campaign.coverageAnalysis)
    ) {
        throw new Error('Dry run conflicts with the original campaign selection or coverage mode.');
    }
    return { kind: 'dry', baseline: campaign, testFiles };
}

export async function resolveMutantInvocation(
    runner: ReadyMutationRunner,
    baseline: MutationBaseline,
    invocation: MutantInvocation
): Promise<MutantInvocationPlan & { readonly campaign: CampaignBaseline; }> {
    const { input, ignoreStatic, budget } = invocation;
    const campaign = await baseline.read(runner.client, budget);
    if (campaign === null) {
        throw new Error('Campaign dry-run baseline is unavailable.');
    }
    return { campaign, ...planMutantInvocation({ root: runner.root, campaign, input, ignoreStatic }) };
}
