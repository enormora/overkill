import { z } from 'zod/v4';
import type { BenchmarkLifecyclePolicy, BenchmarkCooldownPolicy } from '../engine/benchmark-result.ts';
import { maximumRetainedSamples } from '../engine/benchmark-limits.ts';

export const runtimeCooldownWindowMilliseconds = 50;
export const runtimeCooldownQuietWindows = 2;
const minimumCooldownMilliseconds = runtimeCooldownWindowMilliseconds * runtimeCooldownQuietWindows;
const maximumCooldownMilliseconds = 60_000;

export const defaultRuntimeCooldownPolicy: Extract<BenchmarkCooldownPolicy, { readonly mode: 'runtime'; }> = Object
    .freeze({
        mode: 'runtime',
        maximumEventLoopUtilization: 0.1,
        timeoutMilliseconds: 1000
    });

export const defaultBenchmarkLifecyclePolicy: BenchmarkLifecyclePolicy = Object.freeze({
    warmupSamples: 32,
    cooldown: Object.freeze({ mode: 'off' })
});

const benchmarkLifecyclePolicySchema = z.strictObject({
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

export function resolveBenchmarkLifecyclePolicy(
    policy: BenchmarkLifecyclePolicy | undefined
): BenchmarkLifecyclePolicy {
    const validated = benchmarkLifecyclePolicySchema.prefault(defaultBenchmarkLifecyclePolicy).parse(policy);
    return Object.freeze({ ...validated, cooldown: Object.freeze(validated.cooldown) });
}
