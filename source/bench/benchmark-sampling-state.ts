import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { BenchmarkBudgetResult, MetricReading } from '../engine/benchmark-result.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import { evaluateMetricBudget, inferentialTargetKey } from './benchmark-budget.ts';
import {
    createMetricObservations,
    normalizeBenchmarkMetrics,
    type MetricObservations
} from './benchmark-observations.ts';
import {
    generatedBudgetAssertions,
    recordRawSamples,
    summarizedSamplingResult
} from './benchmark-sampling-evidence.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { unavailableMetric } from './metric-reading.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';

const checkpointGrowth = 2;
export type SamplingState = {
    readonly samples: () => number;
    readonly observe: (returned: unknown) => void;
    readonly checkpoint: () => Promise<boolean>;
    readonly finish: () => Promise<AssertionResult>;
    readonly interrupt: (error: unknown) => Promise<never>;
};

function inferentialTargetCount(input: SamplingSessionInput): number {
    const targets = new Set(input.budgets.flatMap(function target(budget) {
        const key = inferentialTargetKey(budget);
        return key === null ? [] : [ key ];
    }));
    return Math.max(1, targets.size);
}

function evaluateBudgets(
    input: SamplingSessionInput,
    observations: ReadonlyMap<string, MetricObservations>,
    checkpoint: number,
    samples: number
): readonly BenchmarkBudgetResult[] {
    const delta = (1 - input.policy.confidenceLevel) / (inferentialTargetCount(input) * checkpoint * (checkpoint + 1));
    return input.budgets.map(function evaluate(budget) {
        const values = observations.get(budget.metric)?.values() ?? [];
        const result = evaluateMetricBudget(values, budget, input.policy, delta);
        return values.length === samples ? result : { ...result, decision: 'unavailable', precise: false };
    });
}

function settledBudgets(results: readonly BenchmarkBudgetResult[]): boolean {
    return results.length > 0 && results.every(function settled(budget) {
        return budget.decision === 'unavailable' || budget.precise && budget.decision !== 'undecided';
    });
}

function observationReadings(
    returned: unknown,
    observations: ReadonlyMap<string, MetricObservations>
): readonly (readonly [MetricObservations, MetricReading])[] {
    const normalized = normalizeBenchmarkMetrics(returned);
    for (const name of Object.keys(normalized)) {
        if (!observations.has(name)) {
            throw new TypeError(`Returned metric ${name} requires a budget or diagnostic declaration.`);
        }
    }

    return Array.from(observations, function reading([ name, metric ]) {
        const value = normalized[name] ??
            unavailableMetric('Metric was not returned by measure().', {
                collector: 'measure-return',
                scope: 'custom',
                unit: 'number'
            });
        metric.validate(value);
        return [ metric, value ];
    });
}

function commitObservation(returned: unknown, observations: ReadonlyMap<string, MetricObservations>): void {
    try {
        const readings = observationReadings(returned, observations);
        readings.forEach(function append([ metric, reading ]) {
            metric.append(reading);
        });
    } catch (error: unknown) {
        throw new CaseRunnerError('Benchmark returned invalid measurement data.', {
            subtype: 'measurement',
            cause: error
        });
    }
}

export function createSamplingState(input: SamplingSessionInput): SamplingState {
    const names = new Set([
        ...input.budgets.map(function metricName(budget) {
            return budget.metric;
        }),
        ...input.diagnostics
    ]);
    const observations = new Map(Array.from(names, function metric(name) {
        return [ name, createMetricObservations() ];
    }));
    let samples = 0;
    let checkpoint = 0;
    let nextCheckpoint = input.policy.minimumSamples;
    let budgets: readonly BenchmarkBudgetResult[] = [];
    return {
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
            budgets = evaluateBudgets(input, observations, checkpoint, samples);
            await input.scope.updateResult(
                summarizedSamplingResult(input, observations, { samples, budgets, status: 'sampling' })
            );
            nextCheckpoint = Math.min(nextCheckpoint * checkpointGrowth, input.policy.maximumSamples);
            return settledBudgets(budgets);
        },
        async finish() {
            const complete = settledBudgets(budgets);
            const result = await recordRawSamples(
                summarizedSamplingResult(input, observations, {
                    samples,
                    budgets,
                    status: complete ? 'complete' : 'incomplete'
                }),
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
            await input.scope.updateResult(
                summarizedSamplingResult(input, observations, { samples, budgets, status: 'incomplete' })
            );
            if (error instanceof MeasurementContractError) {
                throw new CaseRunnerError(error.message, { subtype: 'measurement', cause: error });
            }
            throw error;
        }
    };
}
