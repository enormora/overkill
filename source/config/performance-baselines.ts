import { z } from 'zod/v4';
import type { BenchmarkBaselinePolicy, PerformanceBaselineAdapter } from '../baselines/performance-adapter.ts';

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
