import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { workIdSchema } from '../engine/identity-schema.ts';
import { calibrationSnapshotSchema } from '../bench/calibration-evidence.ts';

export const storedCalibrationSchema = z.strictObject({
    profile: z.string().min(1),
    owners: z.array(workIdSchema),
    snapshot: calibrationSnapshotSchema,
    version: z.literal(1)
});
export type StoredCalibration = ReadonlyDeep<z.infer<typeof storedCalibrationSchema>>;
