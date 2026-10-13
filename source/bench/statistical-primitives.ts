import * as statistics from 'simple-statistics';

function evaluateStatistic(name: string, parameters: readonly unknown[]): number {
    const statistic: unknown = Reflect.get(statistics, name);
    if (typeof statistic !== 'function') {
        throw new TypeError(`Statistics package does not provide ${name}.`);
    }
    const value: unknown = Reflect.apply(statistic, undefined, parameters);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`Statistic ${name} did not produce a finite value.`);
    }
    return value;
}

function scaledStatistic(name: string, values: readonly number[], parameters: readonly unknown[]): number {
    const scale = values.reduce(function maximumMagnitude(previous, value) {
        return Math.max(previous, Math.abs(value));
    }, 0);
    if (scale === 0) {
        return 0;
    }
    return evaluateStatistic(name, [
        values.map(function normalize(value) {
            return value / scale;
        }),
        ...parameters
    ]) * scale;
}

export function observationMean(values: readonly number[]): number {
    return scaledStatistic('mean', values, []);
}
export function observationMedian(values: readonly number[]): number {
    return scaledStatistic('median', values, []);
}
export function observationQuantile(sorted: readonly number[], probability: number): number {
    return scaledStatistic('quantileSorted', sorted, [ probability ]);
}
export function observationVariance(values: readonly number[]): number {
    return evaluateStatistic('sampleVariance', [ values ]);
}
