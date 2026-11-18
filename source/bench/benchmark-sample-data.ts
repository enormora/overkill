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
export function readRawBenchmarkSamples(value: unknown): RawBenchmarkSamples {
    return attributedSamplesSchema.parse(value);
}
