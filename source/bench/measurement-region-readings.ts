import type { Measured, MetricReadings } from './measurement-types.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { microsecondsPerSecond } from './measurement-units.ts';
import { attributeReading } from './measurement-attribution.ts';

export function regionMetrics(
    duration: number,
    count: number,
    readings: readonly MetricReadings[]
): Measured<unknown>['metrics'] {
    const collected = Object.fromEntries(readings.flatMap(function readingEntries(reading) {
        return Object.entries(reading);
    }));
    const provenance = { collector: 'wall-clock', scope: 'region' as const, unit: 'operations/second' };
    const metrics = {
        ...collected,
        durationMicroseconds: availableMetric(duration, {
            collector: 'wall-clock',
            scope: 'region',
            unit: 'microseconds'
        }),
        operationsPerSecond: duration === 0
            ? unavailableMetric('Measured duration is zero.', provenance)
            : availableMetric(count * microsecondsPerSecond / duration, provenance)
    };
    Object.values(metrics).forEach(function attributeMetric(reading) {
        attributeReading(reading);
    });
    return metrics;
}
