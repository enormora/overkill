import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { workIdSchema } from '../engine/identity-schema.ts';
import { baselineIdentityKey } from '../baselines/baseline-planning.ts';
import type { BaselineChange, BaselineEntry, BaselineIdentity } from '../baselines/baseline-model.ts';
import type { BaselinePayload } from '../baselines/ordinary-baseline-adapter.ts';

const payloadSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string() }),
    z.strictObject({ kind: z.literal('binary'), base64: z.base64() })
]);
export const storedOrdinaryBaselineSchema = z.strictObject({
    version: z.literal(1),
    adapter: z.string().min(1),
    profile: z.string().min(1),
    subtype: z.enum([ 'content-snapshot', 'terminal-snapshot', 'visual-snapshot' ]),
    work: workIdSchema,
    comparisonContext: z.record(z.string(), z.string()),
    payload: payloadSchema
});
export type StoredOrdinaryBaseline = ReadonlyDeep<z.infer<typeof storedOrdinaryBaselineSchema>>;
export type OrdinaryBaselineChange = BaselineChange<StoredOrdinaryBaseline>;
export type OrdinaryBaselineEntry = BaselineEntry<StoredOrdinaryBaseline>;
export function persistBaselinePayload(payload: BaselinePayload): StoredOrdinaryBaseline['payload'] {
    return payload.kind === 'text' ? { ...payload } : {
        kind: 'binary',
        base64: Buffer.from(payload.bytes).toString('base64')
    };
}
export function restoreBaselinePayload(payload: StoredOrdinaryBaseline['payload']): BaselinePayload {
    return payload.kind === 'text' ? { ...payload } : {
        kind: 'binary',
        bytes: Buffer.from(payload.base64, 'base64')
    };
}
export function ordinaryBaselineIdentity(baseline: StoredOrdinaryBaseline): BaselineIdentity {
    return {
        adapter: baseline.adapter,
        profile: baseline.profile,
        subtype: baseline.subtype,
        work: baseline.work,
        comparisonContext: baseline.comparisonContext
    };
}
export function baselineFilename(baseline: StoredOrdinaryBaseline): string {
    return `${
        createHash('sha256').update(baselineIdentityKey(ordinaryBaselineIdentity(baseline))).digest('hex')
    }.baseline.json`;
}
