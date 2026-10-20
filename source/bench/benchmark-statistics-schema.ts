import { z } from 'zod/v4';
import type { BudgetStatistic, BenchmarkBudgetResult, MetricReading } from '../engine/benchmark-result.ts';

const provenanceSchema = z.strictObject({
    collector: z.string().min(1),
    scope: z.enum([ 'region', 'thread', 'process', 'runtime', 'custom' ]),
    unit: z.string().min(1)
});
export const metricReadingSchema: z.ZodType<MetricReading> = z.discriminatedUnion('availability', [
    z.strictObject({ availability: z.literal('available'), value: z.number(), provenance: provenanceSchema }),
    z.strictObject({ availability: z.literal('unavailable'), reason: z.string().min(1), provenance: provenanceSchema })
]);
export const budgetStatisticSchema: z.ZodType<BudgetStatistic> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('quantile'), probability: z.number().gt(0).lt(1) }),
    z.strictObject({ kind: z.literal('mean'), range: z.strictObject({ minimum: z.number(), maximum: z.number() }) }),
    z.strictObject({ kind: z.literal('observed-minimum') }),
    z.strictObject({ kind: z.literal('observed-maximum') })
]);
export const metricSummarySchema = z.strictObject({
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

export const benchmarkBudgetResultSchema: z.ZodType<BenchmarkBudgetResult> = z.strictObject({
    metric: z.string(),
    statistic: budgetStatisticSchema,
    minimum: z.number().nullable(),
    maximum: z.number().nullable(),
    estimate: z.number().nullable(),
    interval: z.strictObject({ lower: z.number().nullable(), upper: z.number().nullable() }),
    precise: z.boolean(),
    decision: z.enum([ 'pass', 'fail', 'undecided', 'unavailable' ])
});
