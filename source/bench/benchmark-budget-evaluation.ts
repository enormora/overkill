import type { BenchmarkBudgetResult } from '../engine/benchmark-result.ts';
import {
    evaluateMetricBudget,
    evaluateBudgetInterval,
    statisticInterval,
    inferentialTargetKey
} from './benchmark-budget.ts';
import { normalizeStatisticalInterval } from './normalization-interval.ts';
import type { NormalizedMetricBudget } from './benchmark-budget-definition.ts';
import type { MetricObservations } from './benchmark-observations.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';

import { metricNormalizationEvidence } from './metric-normalization-evidence.ts';

const confidenceComponents = 2;
function inferentialTargetCount(input: SamplingSessionInput): number {
    const targets = new Set(input.budgets.flatMap(function target(budget) {
        const key = metricNormalizationEvidence(input.normalization, budget.metric) === null
            ? inferentialTargetKey(budget)
            : JSON.stringify([ budget.metric, budget.statistic ]);
        return key === null ? [] : [ key ];
    }));
    return Math.max(1, targets.size);
}
function metricBudget(
    input: SamplingSessionInput,
    values: readonly number[],
    budget: NormalizedMetricBudget,
    delta: number
): BenchmarkBudgetResult {
    const normalization = metricNormalizationEvidence(input.normalization, budget.metric);
    if (normalization === null || values.length === 0) {
        return evaluateMetricBudget(values, budget, input.policy, delta);
    }
    const interval = normalizeStatisticalInterval(
        statisticInterval(values, budget.statistic, delta / confidenceComponents),
        {
            actual: normalization.actual,
            reference: normalization.budgetReference,
            scaling: normalization.scaling
        },
        delta / confidenceComponents
    );
    return evaluateBudgetInterval(interval, budget, input.policy);
}
export function evaluateBenchmarkBudgets(
    input: SamplingSessionInput,
    observations: ReadonlyMap<string, MetricObservations>,
    checkpoint: number,
    samples: number
): readonly BenchmarkBudgetResult[] {
    const delta = (1 - input.policy.confidenceLevel) / (inferentialTargetCount(input) * checkpoint * (checkpoint + 1));
    return input.budgets.map(function evaluate(budget) {
        const values = observations.get(budget.metric)?.values() ?? [];
        const result = metricBudget(input, values, budget, delta);
        return values.length === samples ? result : { ...result, decision: 'unavailable', precise: false };
    });
}
