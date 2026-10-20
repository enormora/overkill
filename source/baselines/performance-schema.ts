import { z } from 'zod/v4';
import { normalizationEvidenceSchema } from '../bench/calibration-evidence.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import {
    normalizedPerformanceBaselineVersion,
    previousNormalizedPerformanceBaselineVersion,
    type StoredPerformanceBaseline
} from './performance-baseline.ts';

const legacyPerformanceBaselineSchema = z.strictObject({
    adapter: z.string().min(1),
    expected: z.strictObject({ calibration: comparableCalibrationSchema, value: z.json() }),
    profile: z.string().min(1),
    subtype: z.literal('performance-baseline'),
    version: z.literal(1),
    work: workIdSchema
});

export const storedPerformanceBaselineSchema: z.ZodType<StoredPerformanceBaseline> = z.union([
    legacyPerformanceBaselineSchema,
    legacyPerformanceBaselineSchema.extend({
        version: z.literal(previousNormalizedPerformanceBaselineVersion),
        normalization: normalizationEvidenceSchema.nullable()
    }),
    legacyPerformanceBaselineSchema.extend({
        version: z.literal(normalizedPerformanceBaselineVersion),
        normalization: normalizationEvidenceSchema.nullable()
    })
]);
