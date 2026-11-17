import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { inputDocumentFields } from '../stored-input.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { calibrationSnapshotSchema } from '../bench/calibration-evidence.ts';

export const storedCalibrationSchema = z.strictObject({
    profile: z.string().min(1),
    owners: z.array(workIdSchema),
    snapshot: calibrationSnapshotSchema,
    ...inputDocumentFields
});
export type StoredCalibration = ReadonlyDeep<z.infer<typeof storedCalibrationSchema>>;
