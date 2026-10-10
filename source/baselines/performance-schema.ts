import { z } from 'zod/v4';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import type { StoredPerformanceBaseline } from './performance-baseline.ts';

export const storedPerformanceBaselineSchema: z.ZodType<StoredPerformanceBaseline> = z.strictObject({
    adapter: z.string().min(1),
    expected: z.strictObject({ calibration: comparableCalibrationSchema, value: z.json() }),
    profile: z.string().min(1),
    subtype: z.literal('performance-baseline'),
    version: z.literal(1),
    work: workIdSchema
});
