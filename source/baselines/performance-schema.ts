import { z } from 'zod/v4';
import { normalizationEvidenceSchema } from '../bench/calibration-evidence.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import { measurementComparisonIdentitySchema } from '../bench/measurement-evidence-schema.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { inputDocumentFields } from '../stored-input.ts';
import type { StoredPerformanceBaseline } from './performance-baseline.ts';

export const storedPerformanceBaselineSchema: z.ZodType<StoredPerformanceBaseline> = z.strictObject({
    ...inputDocumentFields,
    adapter: z.string().min(1),
    expected: z.strictObject({ calibration: comparableCalibrationSchema, value: z.json() }),
    profile: z.string().min(1),
    subtype: z.literal('performance-baseline'),
    work: workIdSchema,
    measurement: measurementComparisonIdentitySchema.nullable(),
    normalization: normalizationEvidenceSchema.nullable()
});
