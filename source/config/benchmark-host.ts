import { z } from 'zod/v4';

export const percentScale = 100;
const percentage = z.number().min(0).max(percentScale).nullable().default(null);
export const benchmarkHostLimitsSchema = z
    .strictObject({
        maximumCpuBusyPercent: percentage,
        maximumHostLoadPerCpuPercent: z.number().nonnegative().nullable().default(null),
        minimumAvailableMemoryPercent: percentage,
        maximumLinuxCpuStallPercent: percentage,
        maximumLinuxMemoryStallPercent: percentage,
        maximumLinuxIoStallPercent: percentage,
        minimumDarwinCpuSpeedPercent: percentage,
        minimumDarwinCpuSchedulerPercent: percentage
    })
    .readonly();

export const benchmarkHostPolicySchema = z
    .strictObject({
        limits: benchmarkHostLimitsSchema.prefault({})
    })
    .readonly();

export type BenchmarkHostLimits = z.infer<typeof benchmarkHostLimitsSchema>;
export type BenchmarkHostPolicy = z.infer<typeof benchmarkHostPolicySchema>;

export function validateNormalizedBenchmarkHostPolicy(policy: BenchmarkHostPolicy): void {
    benchmarkHostPolicySchema.parse(policy);
    const limitNames = benchmarkHostLimitsSchema.unwrap().keyof().options;
    if (
        limitNames.some(function missingLimit(name) {
            return !Object.hasOwn(policy.limits, name);
        })
    ) {
        throw new TypeError('Normalized benchmark host limits must include every limit explicitly.');
    }
}
