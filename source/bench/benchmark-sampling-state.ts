import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { BenchmarkBudgetResult, BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import { CaseRunnerError, isCaseRunnerError } from '../engine/run-result.ts';
import { evaluateBenchmarkBudgets } from './benchmark-budget-evaluation.ts';
import { summarizeNormalization } from './normalization-summaries.ts';
import { commitObservation, createObservationSet } from './benchmark-observation-set.ts';
import {
    generatedBudgetAssertions,
    retainBenchmarkEvidence,
    recordRawSamples,
    summarizedSamplingResult
} from './benchmark-sampling-evidence.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import type { BenchmarkLifecycle } from './benchmark-lifecycle.ts';

const checkpointGrowth = 2;
export type SamplingState = {
    readonly progress: () => Promise<void>;
    readonly samples: () => number;
    readonly observe: (returned: unknown) => void;
    readonly checkpoint: () => Promise<boolean>;
    readonly finish: () => Promise<AssertionResult>;
    readonly interrupt: (error: unknown) => Promise<AssertionResult>;
};

function settledBudgets(results: readonly BenchmarkBudgetResult[]): boolean {
    return results.length > 0 && results.every(function settled(budget) {
        return budget.decision === 'unavailable' || budget.precise && budget.decision !== 'undecided';
    });
}

export function createSamplingState(input: SamplingSessionInput, lifecycle: BenchmarkLifecycle): SamplingState {
    const names = new Set([
        ...input.budgets.map(function metricName(budget) {
            return budget.metric;
        }),
        ...input.diagnostics
    ]);
    const observations = createObservationSet(names);
    let samples = 0;
    let checkpoint = 0;
    let nextCheckpoint = input.policy.minimumSamples;
    let budgets: readonly BenchmarkBudgetResult[] = [];
    const summarize = function summarize(status: BenchmarkExecutionResult['status']): BenchmarkExecutionResult {
        const result = summarizedSamplingResult(input, observations, {
            samples,
            budgets,
            status,
            lifecycle: lifecycle.snapshot()
        });
        return { ...result, normalization: summarizeNormalization(result, checkpoint) };
    };
    return {
        async progress() {
            await input.scope.updateResult(summarize('sampling'));
        },
        samples() {
            return samples;
        },
        observe(returned) {
            commitObservation(returned, observations);
            samples += 1;
        },
        async checkpoint() {
            if (samples !== nextCheckpoint) {
                return false;
            }
            checkpoint += 1;
            budgets = evaluateBenchmarkBudgets(input, observations, checkpoint, samples);
            await input.scope.updateResult(summarize('sampling'));
            nextCheckpoint = Math.min(nextCheckpoint * checkpointGrowth, input.policy.maximumSamples);
            return settledBudgets(budgets);
        },
        async finish() {
            await retainBenchmarkEvidence(lifecycle.retainWarmup);
            const snapshot = summarize('complete');
            const complete = settledBudgets(budgets) && snapshot.normalization?.comparability.kind !== 'non-comparable';
            const result = await recordRawSamples(
                { ...snapshot, status: complete ? 'complete' : 'incomplete' },
                observations
            );
            await input.scope.updateResult(result);
            if (!complete) {
                input.scope.reportError(
                    new CaseRunnerError('Benchmark sampling limit reached before budgets were resolved.', {
                        subtype: 'measurement',
                        cause: { samples, budgets }
                    })
                );
            }
            return generatedBudgetAssertions(budgets, input);
        },
        async interrupt(error) {
            try {
                await retainBenchmarkEvidence(lifecycle.retainWarmup);
                await input.scope.updateResult(await recordRawSamples(summarize('incomplete'), observations));
            } catch (evidenceError: unknown) {
                throw new AggregateError(
                    [ error, evidenceError ],
                    'Benchmark execution and evidence delivery failed.',
                    { cause: evidenceError }
                );
            }
            const interruption = error instanceof MeasurementContractError
                ? new CaseRunnerError(error.message, { subtype: 'measurement', cause: error })
                : error;
            if (
                isCaseRunnerError(interruption) && budgets.some(function failed(budget) {
                    return budget.decision === 'fail';
                })
            ) {
                input.scope.reportError(interruption);
                return generatedBudgetAssertions(budgets, input);
            }
            throw interruption;
        }
    };
}
