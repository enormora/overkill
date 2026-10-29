import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { workIdSchema } from '../engine/identity-schema.ts';
import { verdictSchema } from './run-artifact-schema.ts';

const family = z.enum([ 'microtest', 'integration', 'benchmark', 'property' ]);
const execution = z.union([
    z.object({
        processModel: z.enum([ 'in-process', 'supervised-process' ]),
        scheduling: z.enum([ 'serial', 'concurrent' ])
    }),
    z.object({
        processModel: z.literal('worker-pool'),
        scheduling: z.enum([ 'serial', 'concurrent' ]),
        workerLifecycle: z.enum([ 'reuse', 'fresh-worker-per-unit' ])
    })
]);
const count = z.number().int().nonnegative();
const result = z.object({
    runnerErrors: z.array(z.unknown()).readonly(),
    summary: z.object({
        failed: count,
        crashed: count,
        processExhausted: count,
        runtimePolicy: count,
        inconclusive: count
    }),
    timings: z.object({ summary: z.object({ totalWallTimeMicroseconds: z.number().nonnegative() }) }),
    perTest: z
        .array(z.object({
            workId: workIdSchema,
            verdict: verdictSchema,
            durationMicroseconds: z.number().nonnegative()
        }))
        .readonly()
});
const fields = {
    version: z.literal(1),
    kind: z.literal('single'),
    id: z.string().min(1),
    startedAt: z.iso.datetime({ offset: true }),
    request: z.object({ profile: z.string() }),
    execution,
    facts: z.object({ execution: z.object({ testFamily: family }) }).nullable()
};
export const historyRecordSchema = z.discriminatedUnion('status', [
    z.object({ ...fields, status: z.literal('completed'), result }),
    z.object({ ...fields, status: z.enum([ 'started', 'interrupted' ]), result: result.nullable() })
]);
export type HistoryRecord = ReadonlyDeep<z.output<typeof historyRecordSchema>>;
