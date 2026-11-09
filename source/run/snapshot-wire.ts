import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import { storedOrdinaryBaselineSchema } from './baseline-record.ts';

export const snapshotRunSchema = z.strictObject({
    profile: z.string(),
    mode: z.enum([ 'none', 'apply', 'update', 'bootstrap', 'diff' ]),
    maxBytes: z.number().int().positive(),
    entries: z.array(storedOrdinaryBaselineSchema)
});
export type SnapshotRun = ReadonlyDeep<z.infer<typeof snapshotRunSchema>>;
