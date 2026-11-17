import { z } from 'zod/v4';
import { rawBenchmarkSamplesVersion, type RawBenchmarkSamples } from '../engine/measurement-evidence.ts';
import { metricReadingSchema } from './benchmark-statistics-schema.ts';
import { readingAttributionSchema } from './measurement-evidence-schema.ts';

const attributedSamplesSchema = z.strictObject({
    version: z.literal(rawBenchmarkSamplesVersion),
    metrics: z.record(
        z.string(),
        z.array(z.strictObject({ reading: metricReadingSchema, attribution: readingAttributionSchema.nullable() }))
    )
});
const historicalSamplesSchema = z.record(z.string(), z.array(metricReadingSchema)).transform(
    function historicalAttribution(metrics): RawBenchmarkSamples {
        return {
            version: rawBenchmarkSamplesVersion,
            metrics: Object.fromEntries(
                Object
                    .entries(metrics)
                    .map(function historicalMetric([ name, readings ]) {
                        return [
                            name,
                            readings.map(function historicalReading(reading) {
                                return { reading, attribution: null };
                            })
                        ];
                    })
            )
        };
    }
);
const samplesSchema: z.ZodType<RawBenchmarkSamples> = z.union([ attributedSamplesSchema, historicalSamplesSchema ]);
export function readRawBenchmarkSamples(value: unknown): RawBenchmarkSamples {
    return samplesSchema.parse(value);
}
