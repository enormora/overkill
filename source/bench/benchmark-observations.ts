import { z } from 'zod/v4';
import type { BenchmarkMetricSummary, MetricReading } from '../engine/benchmark-result.ts';
import { observationMean, observationMedian } from './statistical-primitives.ts';
import { availableMetric } from './metric-reading.ts';

const provenanceSchema = z.strictObject({
    collector: z.string().min(1),
    scope: z.enum([ 'region', 'thread', 'process', 'runtime', 'custom' ]),
    unit: z.string().min(1)
});
export const metricReadingSchema: z.ZodType<MetricReading> = z.discriminatedUnion('availability', [
    z.strictObject({ availability: z.literal('available'), value: z.number(), provenance: provenanceSchema }),
    z.strictObject({ availability: z.literal('unavailable'), reason: z.string().min(1), provenance: provenanceSchema })
]);
const returnedMetricsSchema = z.record(z.string().min(1), z.union([ z.number(), metricReadingSchema ]));

export type MetricObservations = {
    readonly validate: (reading: MetricReading) => void;
    readonly append: (reading: MetricReading) => void;
    readonly readings: () => readonly MetricReading[];
    readonly values: () => readonly number[];
};

export function createMetricObservations(): MetricObservations {
    const readings: MetricReading[] = [];
    const values: number[] = [];
    let provenance: MetricReading['provenance'] | null = null;
    const validate = function validateReading(reading: MetricReading): void {
        if (
            provenance !== null && reading.availability === 'available' &&
            JSON.stringify(provenance) !== JSON.stringify(reading.provenance)
        ) {
            throw new TypeError('Metric changed unit or provenance between samples.');
        }
    };
    return {
        validate,
        append(reading) {
            validate(reading);
            readings.push(reading);
            if (reading.availability === 'available') {
                provenance = reading.provenance;
                values.push(reading.value);
            }
        },
        readings() {
            return readings;
        },
        values() {
            return values;
        }
    };
}

export function normalizeBenchmarkMetrics(value: unknown): Readonly<Record<string, MetricReading>> {
    return Object.fromEntries(
        Object.entries(returnedMetricsSchema.parse(value)).map(function normalizeReading([ name, reading ]) {
            return [
                name,
                typeof reading === 'number'
                    ? availableMetric(reading, { collector: 'measure-return', scope: 'custom', unit: 'number' })
                    : reading
            ];
        })
    );
}

function observationProvenance(observations: MetricObservations): MetricReading['provenance'] {
    const available = observations.readings().find(function (value) {
        return value.availability === 'available';
    });
    const reading = available ?? observations.readings()[0];
    if (reading === undefined) {
        throw new TypeError('Metric summary requires observations.');
    }
    return reading.provenance;
}

export function observationSummary(observations: MetricObservations): BenchmarkMetricSummary {
    const first = observations.readings()[0];
    if (first === undefined) {
        throw new TypeError('Metric summary requires observations.');
    }

    const values = observations.values();
    return {
        count: values.length,
        minimum: values.length === 0 ? null : values.reduce(function minimum(previous, value) {
            return Math.min(previous, value);
        }),
        maximum: values.length === 0 ? null : values.reduce(function maximum(previous, value) {
            return Math.max(previous, value);
        }),
        mean: values.length === 0 ? null : observationMean(values),
        median: values.length === 0 ? null : observationMedian(values),
        provenance: observationProvenance(observations),
        unavailableReasons: Array.from(
            new Set(
                observations.readings().flatMap(function unavailableReason(reading) {
                    return reading.availability === 'unavailable' ? [ reading.reason ] : [];
                })
            )
        )
    };
}
