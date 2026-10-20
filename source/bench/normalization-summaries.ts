import type {
    BenchmarkExecutionResult,
    BenchmarkMetricSummary,
    BenchmarkBudgetResult,
    BenchmarkNormalizationEvidence
} from '../engine/benchmark-result.ts';
import { calibrationFactor, normalizeStatisticalInterval } from './normalization-interval.ts';

function scaledNumber(value: number | null, factor: number): number | null {
    if (value === null) {
        return null;
    }
    const scaled = value * factor;
    if (!Number.isFinite(scaled)) {
        throw new TypeError('Normalized benchmark value is not finite.');
    }
    return scaled;
}
function scaledSummary(summary: BenchmarkMetricSummary, factor: number): BenchmarkMetricSummary {
    return {
        ...summary,
        minimum: scaledNumber(summary.minimum, factor),
        maximum: scaledNumber(summary.maximum, factor),
        mean: scaledNumber(summary.mean, factor),
        median: scaledNumber(summary.median, factor)
    };
}
function scaledBudget(budget: BenchmarkBudgetResult, factor: number): BenchmarkBudgetResult {
    return {
        ...budget,
        minimum: scaledNumber(budget.minimum, factor),
        maximum: scaledNumber(budget.maximum, factor),
        estimate: scaledNumber(budget.estimate, factor),
        interval: {
            lower: scaledNumber(budget.interval.lower, factor),
            upper: scaledNumber(budget.interval.upper, factor)
        }
    };
}
function normalizedSummaries(
    result: BenchmarkExecutionResult,
    checkpoint: number
): BenchmarkNormalizationEvidence | null {
    const { normalization } = result;
    if (normalization === null) {
        return null;
    }
    const targets = Math.max(1, result.budgets.length);
    const look = Math.max(1, checkpoint);
    const delta = (1 - result.policy.confidenceLevel) / (targets * look * (look + 1));
    return {
        ...normalization,
        metrics: Object.fromEntries(
            Object.entries(normalization.metrics).map(function summarizeMetric([ name, evidence ]) {
                const factor = normalizeStatisticalInterval({ estimate: 1, lower: 1, upper: 1 }, {
                    actual: evidence.actual,
                    reference: evidence.reference,
                    scaling: evidence.scaling
                }, delta);
                const budgetFactor = calibrationFactor(evidence.budgetReference, evidence.reference, evidence.scaling);
                const summary = result.metrics[name];
                return [ name, {
                    ...evidence,
                    factor,
                    summary: summary === undefined ? null : scaledSummary(summary, factor.estimate),
                    budgets: result
                        .budgets
                        .filter(function metricBudget(budget) {
                            return budget.metric === name;
                        })
                        .map(function displayBudget(budget) {
                            return scaledBudget(budget, budgetFactor);
                        })
                } ];
            })
        )
    };
}

export function summarizeNormalization(
    result: BenchmarkExecutionResult,
    checkpoint: number
): BenchmarkNormalizationEvidence | null {
    try {
        return normalizedSummaries(result, checkpoint);
    } catch (error: unknown) {
        return result.normalization === null
            ? null
            : {
                ...result.normalization,
                comparability: {
                    kind: 'non-comparable',
                    reason: error instanceof Error
                        ? error.message
                        : String(error)
                }
            };
    }
}
