import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import type { BenchmarkBudgetResult, BudgetStatistic, SamplingPolicy } from '../engine/benchmark-result.ts';
import { minimumInferentialSamples } from '../engine/benchmark-limits.ts';
import { observationMean, observationQuantile, observationVariance } from './statistical-primitives.ts';
import type { NormalizedMetricBudget } from './benchmark-budget-definition.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';

type MeanObservationRange = { readonly minimum: number; readonly maximum: number; };
export type StatisticalInterval = {
    readonly estimate: number;
    readonly lower: number | null;
    readonly upper: number | null;
};
type BoundDecision = 'inside' | 'outside' | 'unknown';
type BoundComparison = (value: number, threshold: number) => boolean;
const twoSidedIntervalCount = 2;
const bernsteinVarianceMultiplier = 2;
const bernsteinLogarithmMultiplier = 4;
const bernsteinRangeMultiplier = 7;
const bernsteinRangeDivisor = 3;

export function quantileInterval(values: readonly number[], probability: number, delta: number): StatisticalInterval {
    const sorted = values.toSorted(function ascending(left, right) {
        return left - right;
    });
    const lowerRank = binomialQuantile(delta / twoSidedIntervalCount, sorted.length, probability);
    const upperRank = binomialQuantile(1 - delta / twoSidedIntervalCount, sorted.length, probability) + 1;
    return {
        estimate: observationQuantile(sorted, probability),
        lower: sorted[lowerRank - 1] ?? null,
        upper: sorted[upperRank - 1] ?? null
    };
}

function meanRadius(values: readonly number[], delta: number): number {
    if (values.length < minimumInferentialSamples) {
        return 1;
    }
    const logarithm = Math.log(bernsteinLogarithmMultiplier / delta);
    return Math.sqrt(bernsteinVarianceMultiplier * observationVariance(values) * logarithm / values.length) +
        bernsteinRangeMultiplier * logarithm / (bernsteinRangeDivisor * (values.length - 1));
}

export function boundedMeanInterval(
    values: readonly number[],
    range: MeanObservationRange,
    delta: number
): StatisticalInterval {
    if (
        values.some(function outsideRange(value) {
            return value < range.minimum || value > range.maximum;
        })
    ) {
        throw new MeasurementContractError('Mean observation falls outside the declared range.', {});
    }
    const width = range.maximum - range.minimum;
    if (width === 0) {
        return { estimate: range.minimum, lower: range.minimum, upper: range.maximum };
    }
    const normalized = values.map(function normalize(value) {
        return (value - range.minimum) / width;
    });
    const average = observationMean(normalized);
    const radius = meanRadius(normalized, delta);
    return {
        estimate: range.minimum + average * width,
        lower: range.minimum + Math.max(0, average - radius) * width,
        upper: range.minimum + Math.min(1, average + radius) * width
    };
}

function statisticInterval(values: readonly number[], statistic: BudgetStatistic, delta: number): StatisticalInterval {
    if (statistic.kind === 'quantile') {
        return quantileInterval(values, statistic.probability, delta);
    }
    if (statistic.kind === 'mean') {
        return boundedMeanInterval(values, statistic.range, delta);
    }
    const estimate = values.reduce(function extreme(previous, value) {
        return statistic.kind === 'observed-minimum' ? Math.min(previous, value) : Math.max(previous, value);
    }, values[0] ?? 0);
    return { estimate, lower: estimate, upper: estimate };
}

function boundDecision(
    threshold: number | null,
    inside: number | null,
    outside: number | null,
    compare: BoundComparison
): BoundDecision {
    if (threshold === null) {
        return 'inside';
    }
    if (inside !== null && compare(inside, threshold)) {
        return 'inside';
    }
    if (outside !== null && !compare(outside, threshold)) {
        return 'outside';
    }
    return 'unknown';
}

function intervalDecision(
    interval: StatisticalInterval,
    budget: NormalizedMetricBudget
): BenchmarkBudgetResult['decision'] {
    const decisions = [
        boundDecision(budget.minimum, interval.lower, interval.upper, function aboveMinimum(value, threshold) {
            return value >= threshold;
        }),
        boundDecision(budget.maximum, interval.upper, interval.lower, function belowMaximum(value, threshold) {
            return value <= threshold;
        })
    ];
    if (decisions.includes('outside')) {
        return 'fail';
    }
    const inside = decisions.every(function isInside(decision) {
        return decision === 'inside';
    });
    return inside ? 'pass' : 'undecided';
}

function sufficientlyPrecise(
    interval: StatisticalInterval,
    budget: NormalizedMetricBudget,
    policy: SamplingPolicy
): boolean {
    const tolerance = Math.max(
        Math.abs(interval.estimate) * policy.relativePrecision,
        policy.absolutePrecision[budget.metric] ?? 0
    );
    return interval.lower !== null && interval.upper !== null &&
        (interval.upper - interval.lower) / twoSidedIntervalCount <= tolerance;
}

export function evaluateMetricBudget(
    values: readonly number[],
    budget: NormalizedMetricBudget,
    policy: SamplingPolicy,
    delta: number
): BenchmarkBudgetResult {
    if (values.length === 0) {
        return {
            ...budget,
            estimate: null,
            interval: { lower: null, upper: null },
            precise: false,
            decision: 'unavailable'
        };
    }
    const interval = statisticInterval(values, budget.statistic, delta);
    return {
        ...budget,
        estimate: interval.estimate,
        interval: { lower: interval.lower, upper: interval.upper },
        precise: sufficientlyPrecise(interval, budget, policy),
        decision: intervalDecision(interval, budget)
    };
}

export function inferentialTargetKey(budget: NormalizedMetricBudget): string | null {
    return budget.statistic.kind === 'mean' || budget.statistic.kind === 'quantile'
        ? JSON.stringify([ budget.metric, budget.statistic ])
        : null;
}
