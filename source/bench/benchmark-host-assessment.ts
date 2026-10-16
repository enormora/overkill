import { benchmarkHostLimitsSchema, type BenchmarkHostLimits } from '../config/benchmark-host.ts';
import type { BenchmarkHostAssessment, BenchmarkHostCheck, BenchmarkHostSnapshot } from './benchmark-host-snapshot.ts';

const signals = {
    maximumCpuBusyPercent: 'cpuBusyPercent',
    maximumHostLoadPerCpuPercent: 'hostLoadPerCpuPercent',
    minimumAvailableMemoryPercent: 'availableMemoryPercent',
    maximumLinuxCpuStallPercent: 'linuxCpuStallPercent',
    maximumLinuxMemoryStallPercent: 'linuxMemoryStallPercent',
    maximumLinuxIoStallPercent: 'linuxIoStallPercent',
    minimumDarwinCpuSpeedPercent: 'darwinCpuSpeedPercent',
    minimumDarwinCpuSchedulerPercent: 'darwinCpuSchedulerPercent'
} as const;

export function evaluateBenchmarkHost(
    snapshot: BenchmarkHostSnapshot,
    limits: BenchmarkHostLimits
): BenchmarkHostAssessment {
    const checks = benchmarkHostLimitsSchema
        .unwrap()
        .keyof()
        .options
        .flatMap(function evaluateLimit(limit): readonly BenchmarkHostCheck[] {
            const configuredPercent = limits[limit];
            if (configuredPercent === null) {
                return [];
            }
            const reading = snapshot.signals[signals[limit]];
            if (reading.availability === 'unavailable') {
                return [ { limit, configuredPercent, status: 'unavailable', reason: reading.reason } ];
            }
            const violated = limit.startsWith('minimum')
                ? reading.value < configuredPercent
                : reading.value > configuredPercent;
            return [ {
                limit,
                configuredPercent,
                observedPercent: reading.value,
                status: violated ? 'violated' : 'passed'
            } ];
        });
    return { snapshot, limits, checks };
}
