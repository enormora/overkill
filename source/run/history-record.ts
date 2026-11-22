import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import { benchmarkRunFactsSchema } from '../bench/benchmark-run-report.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { familyRunFactsSchema } from './family-transport-schema.ts';
import { runObservationFields, runOutcomeObservationSchema } from './run-result-schema.ts';
import { baselineReportSummariesSchema } from './baseline-report-schema.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import {
    currentRunRecordVersion,
    validateImplementationRecord
} from './run-record-format.ts';

const family = z.string();
const contextFields = benchmarkRunFactsSchema.omit({ execution: true }).extend({
    implementations: z.unknown(),
    family: familyRunFactsSchema.nullable().default(null),
    environment: benchmarkRunFactsSchema.shape.environment.nullable().default(null),
    benchmarkHost: benchmarkRunFactsSchema.shape.benchmarkHost.default(null),
    benchmarkPlacement: benchmarkRunFactsSchema.shape.benchmarkPlacement.default(null),
    benchmarkCalibration: benchmarkRunFactsSchema.shape.benchmarkCalibration.default(null),
    benchmarkNormalization: benchmarkRunFactsSchema.shape.benchmarkNormalization.default(null)
});
const contextExecution = benchmarkRunFactsSchema.shape.execution.partial().extend({ testFamily: family });
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
const result = z.object({
    baselineReports: runObservationFields.baselineReports.or(baselineReportSummariesSchema).default([]),
    preparationFacts: z.record(z.string(), z.unknown()).nullable().default(null),
    resourceChecks: runObservationFields.resourceChecks,
    status: z.enum([ 'passed', 'failed' ]).default('passed'),
    runnerErrors: runObservationFields.runnerErrors.readonly(),
    summary: runObservationFields.summary,
    timings: runObservationFields.timings.strip(),
    perTest: runOutcomeObservationSchema
});
const fields = {
    version: z.literal(currentRunRecordVersion),
    detail: z.enum([ 'compact', 'detailed' ]).default('detailed'),
    identities: z.array(workIdSchema).nullable().default(null),
    versions: z
        .object({
            engine: z.string().nullable(),
            node: z
                .string()
                .nullable()
                .default(null),
            packages: z.record(
                z.string(),
                z.string()
            )
        })
        .nullable()
        .default(null),
    replayPlan: collectedRunPlanSchema.nullable().default(null),
    replayProfile: z.unknown().default(null),
    kind: z.literal('single'),
    id: z.string().min(1),
    startedAt: z.iso.datetime({ offset: true }),
    request: z.object({ profile: z.string(), recordForMerge: z.boolean().default(false) }),
    execution,
    facts: contextFields.extend({ execution: contextExecution }).nullable()
};
const singleHistoryRecordSchema = z.discriminatedUnion('status', [
    z.object({ ...fields, status: z.literal('completed'), result }),
    z.object({ ...fields, status: z.enum([ 'started', 'interrupted' ]), result: result.nullable() })
]);
const mergedHistoryRecordSchema = z
    .object({
        version: z.literal(currentRunRecordVersion),
        kind: z.literal('merged'),
        detail: fields.detail,
        identities: fields.identities,
        versions: fields.versions,
        id: z.string().min(1),
        startedAt: z.iso.datetime({ offset: true }),
        status: z.enum([ 'started', 'completed', 'interrupted' ]),
        facts: contextFields.extend({ execution: contextExecution.extend({ profile: z.string() }).and(execution) }),
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
