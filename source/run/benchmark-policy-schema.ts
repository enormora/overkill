import { z } from 'zod/v4';
import { maximumRetainedSamples, minimumInferentialSamples } from '../engine/benchmark-limits.ts';

export const samplingPolicySchema = z
    .strictObject({
        confidenceLevel: z.number().gt(0).lt(1),
        relativePrecision: z.number().nonnegative(),
        absolutePrecision: z.record(z.string(), z.number().nonnegative()),
        minimumSamples: z.number().int().min(minimumInferentialSamples),
        maximumSamples: z.number().int().min(minimumInferentialSamples).max(maximumRetainedSamples)
    })
    .refine(function orderedLimits(policy) {
        return policy.minimumSamples <= policy.maximumSamples;
    });

const minimumCooldownMilliseconds = 100;
const maximumCooldownMilliseconds = 60_000;
export const legacyLifecyclePolicySchema = z.strictObject({
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

export const benchmarkLifecyclePolicySchema = legacyLifecyclePolicySchema.extend({
    garbageCollection: z.enum([ 'off', 'after-sample', 'profile-default' ]).default('off')
});
