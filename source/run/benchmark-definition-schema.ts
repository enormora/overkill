import { z } from 'zod/v4';
import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import {
    benchmarkLifecyclePolicySchema,
    budgetStatisticSchema,
    samplingPolicySchema
} from './benchmark-result-schema.ts';

export const benchmarkDefinitionSchema: z.ZodType<BenchmarkDefinitionSummary> = z.strictObject({
    lifecycle: benchmarkLifecyclePolicySchema.nullable().default(null),
    kind: z.string(),
    workloads: z.array(z.strictObject({ name: z.string(), parameters: z.record(z.string(), z.json()) })),
    measurement: z.union([
        z.strictObject({
            mode: z.enum([ 'async', 'sync' ]),
            collectors: z.array(z.strictObject({
                name: z.string(),
                metrics: z.array(z.strictObject({
                    name: z.string(),
                    collector: z.string(),
                    scope: z.enum([ 'region', 'thread', 'process', 'runtime', 'custom' ]),
                    unit: z.string()
                }))
            }))
        }),
        z.strictObject({ mode: z.literal('process'), instrumentation: z.enum([ 'node', 'off' ]) })
    ]),
    diagnostics: z.array(z.string()),
    budgets: z.record(
        z.string(),
        z.array(z.strictObject({
            metric: z.string(),
            statistic: budgetStatisticSchema,
            minimum: z.number().nullable(),
            maximum: z.number().nullable()
        }))
    ),
    policy: samplingPolicySchema
});
