import { z } from 'zod/v4';
import type {
    CalibrationIdentity,
    CalibrationSnapshot,
    SavedCalibration,
    BenchmarkNormalizationContext,
    NormalizationRuleSummary,
    BenchmarkNormalizationEvidence
} from '../engine/benchmark-result.ts';
import { maximumRetainedSamples, minimumInferentialSamples } from '../engine/benchmark-limits.ts';
import { workloadIdSchema, workIdSchema } from '../engine/identity-schema.ts';
import { samplingPolicySchema, benchmarkLifecyclePolicySchema } from '../run/benchmark-policy-schema.ts';
import { metricSummarySchema, benchmarkBudgetResultSchema } from './benchmark-statistics-schema.ts';

const checkpointGrowth = 2;

const calibrationIdentitySchema: z.ZodType<CalibrationIdentity> = z.strictObject({
    workload: workloadIdSchema,
    version: z.string().min(1),
    unit: z.string().min(1)
});
export const calibrationSnapshotSchema: z.ZodType<CalibrationSnapshot> = z
    .strictObject({
        version: z.literal(1),
        identity: calibrationIdentitySchema,
        machineClass: z.string().min(1),
        metadata: z.json(),
        sampling: samplingPolicySchema,
        lifecycle: benchmarkLifecyclePolicySchema,
        execution: z.strictObject({ nodeVersion: z.string(), nodeArguments: z.array(z.string()) }),
        checkpoint: z.number().int().positive(),
        samples: z.array(z.number().positive()).min(minimumInferentialSamples).max(maximumRetainedSamples)
    })
    .refine(function validCheckpoint(snapshot) {
        return snapshot.samples.length === Math.min(
            snapshot.sampling.minimumSamples * checkpointGrowth ** (snapshot.checkpoint - 1),
            snapshot.sampling.maximumSamples
        );
    });
const savedCalibrationSchema: z.ZodType<SavedCalibration> = z.strictObject({
    work: workIdSchema,
    metric: z.string().min(1),
    actual: calibrationSnapshotSchema,
    budgetReference: calibrationSnapshotSchema
});
export const benchmarkNormalizationContextSchema: z.ZodType<BenchmarkNormalizationContext> = z.strictObject({
    executionId: z.string().min(1).nullable().default(null),
    mode: z.enum([ 'capture', 'compare' ]),
    profile: z.string().min(1),
    machine: z.strictObject({ machineClass: z.string().min(1), metadata: z.json() }),
    references: z.array(calibrationSnapshotSchema),
    saved: z.array(savedCalibrationSchema)
});
export const normalizationRuleSummarySchema: z.ZodType<NormalizationRuleSummary> = z.strictObject({
    garbageCollection: z.enum([ 'off', 'profile-default', 'after-sample' ]).default('off'),
    calibration: calibrationIdentitySchema,
    scaling: z.enum([ 'proportional', 'inverse' ])
});
export const normalizationEvidenceSchema: z.ZodType<BenchmarkNormalizationEvidence> = z.strictObject({
    version: z.literal(1),
    comparability: z
        .discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('comparable') }),
            z.strictObject({ kind: z.literal('non-comparable'), reason: z.string() })
        ])
        .default({ kind: 'comparable' }),
    calibrations: z.array(calibrationSnapshotSchema),
    metrics: z.record(
        z.string(),
        z.strictObject({
            scaling: z.enum([ 'proportional', 'inverse' ]),
            actual: calibrationSnapshotSchema,
            budgetReference: calibrationSnapshotSchema,
            budgetFactor: z.number().positive().nullable().default(null),
            reference: calibrationSnapshotSchema,
            source: z.enum([ 'baseline', 'canonical', 'fixed' ]),
            factor: z
                .strictObject({ estimate: z.number(), lower: z.number().nullable(), upper: z.number().nullable() })
                .nullable(),
            summary: metricSummarySchema.nullable(),
            budgets: z.array(benchmarkBudgetResultSchema)
        })
    )
});
