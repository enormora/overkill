import { observationQuantile } from '../bench/statistical-primitives.ts';

export type DistributionScale = {
    readonly magnitude: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly count: number;
};
const histogramBins = 20;
const labelPrecision = 4;
const lowerQuartile = 0.25;
const medianProbability = 0.5;
const upperQuartile = 0.75;
const boxProbabilities = [ 0, lowerQuartile, medianProbability, upperQuartile, 1 ];
function sampleMagnitude(minimum: number, maximum: number): number {
    const largest = Math.max(Math.abs(minimum), Math.abs(maximum));
    return largest === 0 ? 1 : largest;
}
export function distributionScale(samples: readonly (readonly number[])[]): DistributionScale {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const values of samples) {
        for (const value of values) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
        }
    }
    if (!Number.isFinite(minimum)) {
        return { magnitude: 1, minimum: 0, maximum: 0, count: 0 };
    }
    const magnitude = sampleMagnitude(minimum, maximum);
    return {
        magnitude,
        minimum: minimum / magnitude,
        maximum: maximum / magnitude,
        count: minimum === maximum ? 1 : histogramBins
    };
}
export function histogramLabels(scale: DistributionScale): readonly string[] {
    return Array.from({ length: scale.count }, function binLabel(_value, index) {
        const lower = (scale.minimum + (scale.maximum - scale.minimum) * index / scale.count) * scale.magnitude;
        const upper = (scale.minimum + (scale.maximum - scale.minimum) * (index + 1) / scale.count) * scale.magnitude;
        return scale.count === 1
            ? String(lower)
            : `${lower.toPrecision(labelPrecision)} to ${upper.toPrecision(labelPrecision)}`;
    });
}
export function sampleHistogram(values: readonly number[], scale: DistributionScale): readonly number[] {
    const bins = Array.from({ length: scale.count }, function emptyBin() {
        return 0;
    });
    for (const value of values) {
        const fraction = scale.count === 1
            ? 0
            : (value / scale.magnitude - scale.minimum) / (scale.maximum - scale.minimum);
        const index = Math.max(0, Math.min(scale.count - 1, Math.floor(fraction * scale.count)));
        bins[index] = (bins[index] ?? 0) + 1;
    }
    return bins;
}
export function sampleBox(values: readonly number[]): readonly number[] {
    if (values.length === 0) {
        return [];
    }
    const sorted = values.toSorted(function numericOrder(left, right) {
        return left - right;
    });
    return boxProbabilities.map(function quantile(probability) {
        return observationQuantile(sorted, probability);
    });
}
