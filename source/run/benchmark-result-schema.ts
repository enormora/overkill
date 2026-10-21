import { z } from 'zod/v4';
import { metricSummarySchema, benchmarkBudgetResultSchema } from '../bench/benchmark-statistics-schema.ts';
import { normalizationEvidenceSchema } from '../bench/calibration-evidence.ts';
import {
    benchmarkLifecycleVersion,
    type BenchmarkExecutionResult,
    type BenchmarkLifecycleResult
} from '../engine/benchmark-result.ts';
import { workloadIdSchema } from '../engine/identity-schema.ts';
import { benchmarkTimelineEvidenceSchema } from '../bench/timeline-schema.ts';
import { samplingPolicySchema, legacyLifecyclePolicySchema } from './benchmark-policy-schema.ts';

const resolvedLifecyclePolicySchema = legacyLifecyclePolicySchema.extend({
    garbageCollection: z.enum([ 'off', 'after-sample' ])
});

const rawSamplesSchema = z.strictObject({
    status: z.enum([ 'recorded', 'omitted', 'truncated' ]),
    reference: z.string().nullable(),
    reason: z.string().nullable()
});
const legacyLifecycleResultSchema = z.strictObject({
    version: z.literal(1),
    policy: legacyLifecyclePolicySchema,
    warmup: z.strictObject({
        samples: z.number().int().nonnegative(),
        metrics: z.record(z.string(), metricSummarySchema),
        rawSamples: rawSamplesSchema
    }),
    cleanup: z.strictObject({ callbacks: z.number().int().nonnegative(), failures: z.number().int().nonnegative() }),
    cooldown: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('off') }),
        z.strictObject({
            mode: z.literal('runtime'),
            strategy: z.literal('event-loop-utilization-v1'),
            completed: z.number().int().nonnegative(),
            windows: z.number().int().nonnegative(),
            durationMicroseconds: z.number().nonnegative(),
            lastUtilization: z.number().min(0).max(1).nullable(),
            outcome: z.enum([ 'pending', 'settled', 'timed-out', 'cancelled', 'unavailable' ])
        })
    ])
});
const lifecycleResultSchema = z.union([
    legacyLifecycleResultSchema.extend({
        version: z.literal(benchmarkLifecycleVersion),
        policy: resolvedLifecyclePolicySchema,
        garbageCollection: z
            .discriminatedUnion('mode', [
                z.strictObject({ mode: z.literal('off') }),
                z.strictObject({
                    mode: z.literal('after-sample'),
                    completed: z.number().int().nonnegative(),
                    failures: z.number().int().nonnegative()
                })
            ])
            .nullable()
    }),
    legacyLifecycleResultSchema.transform(function historicalGarbageCollection(value): BenchmarkLifecycleResult {
        return {
            ...value,
            version: benchmarkLifecycleVersion,
            policy: { ...value.policy, garbageCollection: 'off' as const },
            garbageCollection: null
        };
    })
]);

export const benchmarkResultSchema: z.ZodType<BenchmarkExecutionResult> = z.strictObject({
    timeline: benchmarkTimelineEvidenceSchema.nullable().default(null),
    normalization: normalizationEvidenceSchema.nullable().default(null),
    lifecycle: lifecycleResultSchema.nullable().default(null),
    workload: workloadIdSchema,
    policy: samplingPolicySchema,
    samples: z.number().int().nonnegative(),
    status: z.enum([ 'sampling', 'complete', 'incomplete' ]),
    assumption: z.literal('independent-stationary-observations'),
    metrics: z.record(z.string(), metricSummarySchema),
    budgets: z.array(benchmarkBudgetResultSchema),
    rawSamples: rawSamplesSchema
});
