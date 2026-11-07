import { z } from 'zod/v4';
import type { BenchmarkBaselinePolicy } from '../baselines/baseline-policy.ts';
import type { PerformanceBaselineAdapter } from '../baselines/performance-adapter.ts';

import type { OrdinaryBaselineAdapter } from '../baselines/ordinary-baseline-adapter.ts';

function isPerformanceBaselineAdapter(value: unknown): value is PerformanceBaselineAdapter {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const id: unknown = Reflect.get(value, 'id');
    return typeof id === 'string' && id.trim().length > 0 &&
        [ 'observe', 'propose', 'compare' ].every(function adapterMethod(method) {
            return typeof Reflect.get(value, method) === 'function';
        });
}

export const performanceBaselinePolicySchema: z.ZodType<BenchmarkBaselinePolicy, BenchmarkBaselinePolicy> = z
    .strictObject({
        adapters: z.array(z.custom<PerformanceBaselineAdapter>(isPerformanceBaselineAdapter)).readonly(),
        directory: z.string().trim().min(1)
    })
    .refine(function uniqueAdapterIds(policy) {
        const ids = new Set(policy.adapters.map(function adapterId(adapter) {
            return adapter.id.normalize('NFC');
        }));
        return ids.size === policy.adapters.length;
    }, 'Performance baseline adapter IDs must be unique.')
    .readonly();

const ordinaryBaselineAdapterSchema: z.ZodType<OrdinaryBaselineAdapter> = z.strictObject({
    id: z.string().min(1).refine(function nonBlankId(id) {
        return id.trim().length > 0;
    }),
    subtype: z.enum([ 'content-snapshot', 'terminal-snapshot', 'visual-snapshot' ]),
    comparisonContext: z.record(z.string(), z.string()),
    evaluate: z.custom<OrdinaryBaselineAdapter['evaluate']>(function isEvaluation(value) {
        return typeof value === 'function';
    })
});

export const ordinaryBaselinePolicySchema = z
    .strictObject({
        adapters: z.array(ordinaryBaselineAdapterSchema).readonly().default([]),
        directory: z.string().trim().min(1).default('test-baselines'),
        stale: z.enum([ 'fail', 'warn' ]).default('fail')
    })
    .refine(function uniqueAdapterIds(policy) {
        const ids = new Set(policy.adapters.map(function adapterId(adapter) {
            return adapter.id.normalize('NFC');
        }));
        return ids.size === policy.adapters.length;
    }, 'Baseline adapter IDs must be unique.')
    .readonly();
