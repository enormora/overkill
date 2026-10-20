import type {
    BenchmarkNormalizationEvidence,
    BenchmarkMetricNormalization
} from '../engine/benchmark-result.ts';

export function metricNormalizationEvidence(
    normalization: BenchmarkNormalizationEvidence | null,
    metric: string
): BenchmarkMetricNormalization | null {
    if (normalization === null || !Object.hasOwn(normalization.metrics, metric)) {
        return null;
    }
    return normalization.metrics[metric] ?? null;
}
