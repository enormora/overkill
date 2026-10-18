import { z } from 'zod/v4';
import type { BenchmarkExecutionResult, BudgetStatistic } from '../engine/benchmark-result.ts';
import { workloadIdSchema } from '../engine/identity-schema.ts';
import { minimumInferentialSamples, maximumRetainedSamples } from '../engine/benchmark-limits.ts';

const minimumCooldownMilliseconds = 100;
const maximumCooldownMilliseconds = 60_000;
export const benchmarkLifecyclePolicySchema = z.strictObject({
    warmupSamples: z.number().int().min(0).max(maximumRetainedSamples),
    cooldown: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('off') }),
        z.strictObject({
            mode: z.literal('runtime'),
            maximumEventLoopUtilization: z.number().min(0).max(1),
            timeoutMilliseconds: z.number().int().gt(minimumCooldownMilliseconds).max(maximumCooldownMilliseconds)
        })
    ])
});

export const budgetStatisticSchema: z.ZodType<BudgetStatistic> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('quantile'), probability: z.number().gt(0).lt(1) }),
    z.strictObject({ kind: z.literal('mean'), range: z.strictObject({ minimum: z.number(), maximum: z.number() }) }),
    z.strictObject({ kind: z.literal('observed-minimum') }),
    z.strictObject({ kind: z.literal('observed-maximum') })
]);
export const samplingPolicySchema = z.strictObject({
    confidenceLevel: z.number().gt(0).lt(1),
    relativePrecision: z.number().nonnegative(),
    absolutePrecision: z.record(z.string(), z.number().nonnegative()),
    minimumSamples: z.number().int().min(minimumInferentialSamples),
    maximumSamples: z.number().int().min(minimumInferentialSamples).max(maximumRetainedSamples)
});
const metricSummarySchema = z.strictObject({
    count: z.number().int().nonnegative(),
    minimum: z.number().nullable(),
    maximum: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    provenance: z.strictObject({
        collector: z.string(),
        scope: z.enum([ 'region', 'thread', 'process', 'runtime', 'custom' ]),
        unit: z.string()
    }),
    unavailableReasons: z.array(z.string())
});
const rawSamplesSchema = z.strictObject({
    status: z.enum([ 'recorded', 'omitted', 'truncated' ]),
    reference: z.string().nullable(),
    reason: z.string().nullable()
});
const lifecycleResultSchema = z.strictObject({
    version: z.literal(1),
    policy: benchmarkLifecyclePolicySchema,
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
export const benchmarkResultSchema: z.ZodType<BenchmarkExecutionResult> = z.strictObject({
    lifecycle: lifecycleResultSchema.nullable().default(null),
    workload: workloadIdSchema,
    policy: samplingPolicySchema,
    samples: z.number().int().nonnegative(),
    status: z.enum([ 'sampling', 'complete', 'incomplete' ]),
    assumption: z.literal('independent-stationary-observations'),
    metrics: z.record(z.string(), metricSummarySchema),
    budgets: z.array(z.strictObject({
        metric: z.string(),
        statistic: budgetStatisticSchema,
        minimum: z.number().nullable(),
        maximum: z.number().nullable(),
        estimate: z.number().nullable(),
        interval: z.strictObject({ lower: z.number().nullable(), upper: z.number().nullable() }),
        precise: z.boolean(),
        decision: z.enum([ 'pass', 'fail', 'undecided', 'unavailable' ])
    })),
    rawSamples: rawSamplesSchema
});
