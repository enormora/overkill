import {
    DryRunStatus,
    MutantRunStatus,
    type DryRunOptions,
    type DryRunResult,
    type MutantRunOptions,
    type MutantRunResult
} from '@stryker-mutator/api/test-runner';
import { mutationLifecycleInputSchema } from './mutation-lifecycle.ts';
import { dryMutationResult, mutantExecutionResult } from './mutation-results.ts';
import { mutantActivation, mutantSelection } from './mutation-selection.ts';
import type { ReadyMutationRunner } from './mutation-runner-lifecycle.ts';
import type { MutationBaseline } from './mutation-baseline.ts';

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
export function createMutationRunnerInvocations(
    baseline: MutationBaseline,
    ignoreStatic: boolean
): MutationRunnerInvocations {
    return {
        async dry(runner, input, remaining) {
            runner.execution.admitEnvironment('dry', false);
            const reply = await runner.execution.run(
                mutationLifecycleInputSchema.parse({
                    root: runner.root,
                    mode: 'dry',
                    activeMutant: null,
                    hitLimit: null,
                    coverage: input.coverageAnalysis,
                    baseline: null,
                    selected: null,
                    disableBail: input.disableBail,
                    files: input.testFiles ?? null
                }),
                remaining
            );
            const result = dryMutationResult(runner.root, reply, input.coverageAnalysis);
            if (result.status === DryRunStatus.Complete) {
                await baseline.publish(runner.client, reply);
            }
            return result;
        },
        async mutant(runner, input, remaining) {
            const started = performance.now();
            const campaign = await baseline.fetch(runner.client);
            const mode = mutantActivation(input, runner.root, campaign, ignoreStatic);
            const selected = mutantSelection(runner.root, campaign, input.testFilter ?? null);
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
                    coverage: 'off',
                    baseline: campaign.catalog,
                    selected: mode === 'static'
                        ? campaign.catalog.map(function (entry) {
                            return entry.id;
                        })
                        : selected,
                    disableBail: input.disableBail,
                    files: Array.from(
                        new Set(campaign
                            .catalog
                            .flatMap(function (entry) {
                                return entry.work.case.file === null ? [] : [ entry.work.case.file ];
                            }))
                    )
                }),
                budget
            );
            return mutantExecutionResult(runner.root, reply);
        }
    };
}
