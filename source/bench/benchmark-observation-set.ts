import type { BenchmarkMetricSummary, MetricReading } from '../engine/benchmark-result.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import {
    createMetricObservations,
    normalizeBenchmarkMetrics,
    observationSummary,
    type MetricObservations
} from './benchmark-observations.ts';
import { unavailableMetric } from './metric-reading.ts';

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

export function commitObservation(returned: unknown, observations: ReadonlyMap<string, MetricObservations>): void {
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

export function createObservationSet(names: Iterable<string>): ReadonlyMap<string, MetricObservations> {
    return new Map(Array.from(new Set(names), function metric(name) {
        return [ name, createMetricObservations() ];
    }));
}

export function summarizeObservations(
    observations: ReadonlyMap<string, MetricObservations>
): Readonly<Record<string, BenchmarkMetricSummary>> {
    return Object.fromEntries(
        Array.from(observations).flatMap(function metricSummary([ name, metric ]) {
            return metric.readings().length === 0 ? [] : [ [ name, observationSummary(metric) ] ];
        })
    );
}
