import { z } from 'zod/v4';
import type { BenchmarkExecutionResult, BudgetStatistic } from '../engine/benchmark-result.ts';
import { workloadIdSchema } from '../engine/identity-schema.ts';
import { minimumInferentialSamples, maximumRetainedSamples } from '../engine/benchmark-limits.ts';

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
export const benchmarkResultSchema: z.ZodType<BenchmarkExecutionResult> = z.strictObject({
    workload: workloadIdSchema,
    policy: samplingPolicySchema,
    samples: z.number().int().nonnegative(),
    status: z.enum([ 'sampling', 'complete', 'incomplete' ]),
    assumption: z.literal('independent-stationary-observations'),
    metrics: z.record(
        z.string(),
        z.strictObject({
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
        })
    ),
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
    rawSamples: z.strictObject({
        status: z.enum([ 'recorded', 'omitted', 'truncated' ]),
        reference: z.string().nullable(),
        reason: z.string().nullable()
    })
});
