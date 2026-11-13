import { z } from 'zod/v4';
import { witnessFileSchema } from '../engine/witness-file.ts';
import { loaderSchema } from '../config/schema.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';
import { replayTraceSchema } from './replay-trace-schema.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { replayPlanningSchema } from './replay-planning-schema.ts';
import { currentRunRecordVersion, previousRunRecordVersion } from './run-record-format.ts';

const replayRequestSchema = frozenMicrotestPolicySchema.shape.request.extend({
    capture: z.enum([ 'buffered', 'live' ]),
    baselineUpdateMode: z.enum([ 'apply', 'bootstrap', 'diff', 'none', 'update' ]),
    seed: z.strictObject({ value: z.string().regex(/^\d+$/u) }),
    workers: z.number().int().positive().nullable()
});
export const replayRecordSchema: z.ZodType<ReplayRunRecord> = z
    .object({
        version: z.union([ z.literal(previousRunRecordVersion), z.literal(currentRunRecordVersion) ]),
        kind: z.literal('single'),
        id: z.string().min(1),
        seed: z.string().regex(/^\d+$/u),
        request: replayRequestSchema,
        loader: loaderSchema,
        engine: frozenMicrotestPolicySchema.shape.engine,
        status: z.enum([ 'started', 'completed', 'interrupted' ]),
        replayPlan: collectedRunPlanSchema,
        replayProfile: z.unknown(),
        replayWitness: witnessFileSchema.nullable().default(null),
        identities: z.array(workIdSchema),
        facts: replayPlanningSchema,
        placementTrace: replayTraceSchema.nullable(),
        result: z
            .object({
                planStatus: z.enum([ 'planned', 'empty-selection', 'empty-shard' ]),
                perTest: z.array(z.object({ workId: workIdSchema }))
            })
            .nullable(),
        versions: z.object({ node: z.string(), packages: z.record(z.string(), z.string()) })
    })
    .refine(function familyRecord(record) {
        return record.version !== currentRunRecordVersion || record.facts.family !== null;
    })
    .refine(function completedResult(record) {
        return record.status !== 'completed' || record.result !== null;
    });
