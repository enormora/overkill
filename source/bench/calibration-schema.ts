import { z } from 'zod/v4';
import type {
    BenchmarkCalibrationResult as BenchmarkCalibrationResultDefinition,
    ComparableCalibration
} from '../packages/run/benchmark-calibration.entry-point.ts';

export const comparableCalibrationSchema: z.ZodType<ComparableCalibration> = z.strictObject({
    context: z.json(),
    kind: z.literal('comparable'),
    machineClass: z.string().min(1),
    metadata: z.json()
});
export const benchmarkCalibrationSchema: z.ZodType<BenchmarkCalibrationResult> = z.union([
    comparableCalibrationSchema,
    z.strictObject({ kind: z.literal('non-comparable'), metadata: z.json(), reason: z.string().min(1) })
]);
export type BenchmarkCalibrationResult = BenchmarkCalibrationResultDefinition;
