import { z } from 'zod/v4';
import type { SamplingPolicy } from '../engine/benchmark-result.ts';
import { maximumRetainedSamples, minimumInferentialSamples } from '../engine/benchmark-limits.ts';

export const defaultSamplingPolicy: SamplingPolicy = Object.freeze({
    confidenceLevel: 0.95,
    relativePrecision: 0.05,
    absolutePrecision: Object.freeze({}),
    minimumSamples: 128,
    maximumSamples: maximumRetainedSamples
});
const samplingPolicySchema = z
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

export function validateSamplingPolicy(policy: SamplingPolicy): SamplingPolicy {
    const validated = samplingPolicySchema.parse(policy);
    return Object.freeze({ ...validated, absolutePrecision: Object.freeze(validated.absolutePrecision) });
}
