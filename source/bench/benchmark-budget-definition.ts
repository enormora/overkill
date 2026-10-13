import { z } from 'zod/v4';
import type { BudgetStatistic } from '../engine/benchmark-result.ts';

type BudgetThresholds = {
    readonly maximum: { readonly maximum: number; };
    readonly minimum: { readonly minimum: number; };
    readonly range: { readonly minimum: number; readonly maximum: number; };
};
export type BudgetThreshold = BudgetThresholds[keyof BudgetThresholds];
export type MetricBudget = BudgetThreshold | BudgetThreshold & { readonly statistic: BudgetStatistic; };
export type NormalizedMetricBudget = {
    readonly metric: string;
    readonly statistic: BudgetStatistic;
    readonly minimum: number | null;
    readonly maximum: number | null;
};

const rangeSchema = z.strictObject({ minimum: z.number(), maximum: z.number() }).refine(function orderedRange(range) {
    return range.minimum <= range.maximum && Number.isFinite(range.maximum - range.minimum);
});
const statisticSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('quantile'), probability: z.number().gt(0).lt(1) }),
    z.strictObject({ kind: z.literal('mean'), range: rangeSchema }),
    z.strictObject({ kind: z.literal('observed-minimum') }),
    z.strictObject({ kind: z.literal('observed-maximum') })
]);
const budgetSchema = z
    .strictObject({
        metric: z.string().min(1),
        minimum: z.number().nullable(),
        maximum: z.number().nullable(),
        statistic: statisticSchema
    })
    .refine(function hasThreshold(budget) {
        return budget.minimum !== null || budget.maximum !== null;
    })
    .refine(function orderedThresholds(budget) {
        return budget.minimum === null || budget.maximum === null || budget.minimum <= budget.maximum;
    });

function immutableStatistic(statistic: BudgetStatistic): BudgetStatistic {
    return statistic.kind === 'mean'
        ? Object.freeze({ ...statistic, range: Object.freeze(statistic.range) })
        : Object.freeze(statistic);
}

export function normalizeMetricBudget(metric: string, budget: MetricBudget): NormalizedMetricBudget {
    const input = z.record(z.string(), z.unknown()).parse(budget);
    if (
        Object.keys(input).some(function unknownField(name) {
            return ![ 'minimum', 'maximum', 'statistic' ].includes(name);
        })
    ) {
        throw new TypeError(`Unknown budget field for ${metric}.`);
    }

    const normalized = budgetSchema.parse({
        metric,
        minimum: input.minimum ?? null,
        maximum: input.maximum ?? null,
        statistic: input.statistic ?? { kind: 'quantile', probability: 0.5 }
    });
    return Object.freeze({ ...normalized, statistic: immutableStatistic(normalized.statistic) });
}
