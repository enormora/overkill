import { z } from 'zod/v4';
import type { BaselineIdentity } from '../baselines/baseline-model.ts';
import type { WorkId } from '../engine/identity.ts';
import type { StoredOrdinaryBaseline } from './baseline-record.ts';

const snapshotAdapterId = 'overkill.content-snapshot';
export const snapshotMediaType = 'application/vnd.overkill.snapshot+json';
const snapshotContextSchema = z.strictObject({
    codec: z.literal('1'),
    name: z.string().trim().min(1),
    format: z.enum([ 'text', 'value', 'bytes' ])
});

export function isSupportedSnapshotRecord(baseline: StoredOrdinaryBaseline): boolean {
    return baseline.adapter === snapshotAdapterId && baseline.subtype === 'content-snapshot' &&
        snapshotContextSchema.safeParse(baseline.comparisonContext).success;
}
export function snapshotIdentity(profile: string, work: WorkId, name: string, format: string): BaselineIdentity {
    return {
        adapter: snapshotAdapterId,
        subtype: 'content-snapshot',
        profile,
        work,
        comparisonContext: { name, format, codec: '1' }
    };
}
