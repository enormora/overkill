import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { resourceCheckSnapshotSchema } from '../engine/assertion-result-schema.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import {
    currentRunRecordVersion,
    implementationRunRecordVersion,
    previousRunRecordVersion,
    familyRunRecordVersion,
    validateImplementationRecord
} from './run-record-format.ts';
import { verdictSchema } from './run-artifact-schema.ts';

const family = z.string();
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
    resourceChecks: z.array(resourceCheckSnapshotSchema).default([]),
    status: z.enum([ 'passed', 'failed' ]).default('passed'),
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
    version: z.union([
        z.literal(1),
        z.literal(previousRunRecordVersion),
        z.literal(familyRunRecordVersion),
        z.literal(implementationRunRecordVersion),
        z.literal(currentRunRecordVersion)
    ]),
    replayPlan: collectedRunPlanSchema.nullable().default(null),
    replayProfile: z.unknown().default(null),
    kind: z.literal('single'),
    id: z.string().min(1),
    startedAt: z.iso.datetime({ offset: true }),
    request: z.object({ profile: z.string(), recordForMerge: z.boolean().default(false) }),
    execution,
    facts: z.object({ execution: z.object({ testFamily: family }) }).nullable()
};
const singleHistoryRecordSchema = z.discriminatedUnion('status', [
    z.object({ ...fields, status: z.literal('completed'), result }),
    z.object({ ...fields, status: z.enum([ 'started', 'interrupted' ]), result: result.nullable() })
]);
const mergedHistoryRecordSchema = z
    .object({
        version: z.union([
            z.literal(previousRunRecordVersion),
            z.literal(familyRunRecordVersion),
            z.literal(implementationRunRecordVersion),
            z.literal(currentRunRecordVersion)
        ]),
        kind: z.literal('merged'),
        id: z.string().min(1),
        startedAt: z.iso.datetime({ offset: true }),
        status: z.enum([ 'started', 'completed', 'interrupted' ]),
        facts: z.object({ execution: z.object({ profile: z.string(), testFamily: family }).and(execution) }),
        result
    })
    .transform(function historyProjection(record) {
        return {
            ...record,
            request: { profile: record.facts.execution.profile, recordForMerge: false },
            execution: record.facts.execution,
            replayPlan: null,
            replayProfile: null
        };
    });
export const historyRecordSchema = z.unknown().superRefine(validateImplementationRecord).pipe(
    z.union([ singleHistoryRecordSchema, mergedHistoryRecordSchema ])
);
export type HistoryRecord = ReadonlyDeep<z.output<typeof historyRecordSchema>>;
