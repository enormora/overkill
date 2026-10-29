import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { caseIdSchema as caseId } from '../engine/identity-schema.ts';

const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const caseStatus = z.enum([ 'failed', 'inconclusive', 'passed', 'skipped' ]);
const observation = z.strictObject({ runId: z.string(), observedAt: timestamp, status: caseStatus });
const summary = z.strictObject({
    id: z.string(),
    startedAt: timestamp,
    profile: z.string(),
    testFamily: z.string(),
    status: z.enum([ 'interrupted', 'runner-error', 'failed', 'inconclusive', 'passed' ]),
    durationMicroseconds: z.number().nonnegative().nullable(),
    replayable: z.boolean()
});
const receipt = z.strictObject({
    id: z.string(),
    startedAt: timestamp,
    state: z.enum([ 'provisional', 'completed', 'interrupted' ])
});
export const compactHistorySchema = z.strictObject({
    version: z.literal(1),
    updatedAt: timestamp,
    summaries: z.array(summary),
    receipts: z.array(receipt),
    cases: z.array(z.strictObject({
        identity: caseId,
        observations: z.array(observation),
        counters: z.strictObject({ failed: count, inconclusive: count, passed: count, skipped: count })
    }))
});
export type CompactHistory = ReadonlyDeep<z.output<typeof compactHistorySchema>>;
export type CaseHistoryStatus = z.output<typeof caseStatus>;
export type HistoryRunSummary = ReadonlyDeep<z.output<typeof summary>>;
