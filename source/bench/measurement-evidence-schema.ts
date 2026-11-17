import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import type {
    MeasurementEvidence,
    ReadingAttribution,
    CollectorResult,
    MeasurementComparisonIdentity
} from '../engine/measurement-evidence.ts';
import { metricReadingSchema } from './benchmark-statistics-schema.ts';

const measurementTargetIdentitySchema = z.strictObject({
    semantics: z.record(z.string(), z.string()),
    name: z.string().min(1),
    version: z.string().min(1),
    scope: z.string().min(1),
    clock: z.string().min(1),
    instance: z.string().min(1),
    document: z.string().nullable()
});
const invocationSchema = z.strictObject({
    execution: z.string().min(1),
    work: workIdSchema,
    attempt: z.strictObject({ index: z.number().int().nonnegative() }),
    phase: z.enum([ 'measured', 'warmup' ]),
    index: z.number().int().nonnegative()
});
export const readingAttributionSchema: z.ZodType<ReadingAttribution> = z.strictObject({
    invocation: invocationSchema,
    target: measurementTargetIdentitySchema
});
export const collectorResultSchema: z.ZodType<CollectorResult> = z.strictObject({
    invocation: invocationSchema,
    target: measurementTargetIdentitySchema,
    completeness: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('complete') }),
        z.strictObject({ kind: z.literal('incomplete'), reasons: z.array(z.string()) })
    ]),
    readings: z.record(z.string(), metricReadingSchema)
});
export const measurementComparisonIdentitySchema: z.ZodType<MeasurementComparisonIdentity> = z.strictObject({
    target: measurementTargetIdentitySchema.omit({ instance: true, document: true }),
    collectors: z.array(
        z.strictObject({
            name: z.string(),
            version: z.string(),
            metrics: z.array(z.strictObject({
                name: z.string(),
                collector: z.string(),
                scope: z.enum([ 'custom', 'process', 'region', 'runtime', 'thread' ]),
                unit: z.string()
            }))
        })
    )
});
export const measurementEvidenceSchema: z.ZodType<MeasurementEvidence> = z.strictObject({
    identity: measurementComparisonIdentitySchema,
    version: z.literal(1),
    omitted: z.number().int().nonnegative(),
    invocations: z.array(z.strictObject({
        invocation: invocationSchema,
        target: measurementTargetIdentitySchema,
        collectors: z.array(z.strictObject({
            name: z.string(),
            version: z.string(),
            result: collectorResultSchema.nullable()
        })),
        status: z.enum([ 'complete', 'incomplete' ]),
        errors: z.array(z.string()),
        durationMicroseconds: z.number().nonnegative().nullable(),
        lifecycleMicroseconds: z.number().nonnegative().nullable()
    }))
});
