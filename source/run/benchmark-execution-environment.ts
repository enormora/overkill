import type { BenchmarkNormalizationContext, BenchmarkGarbageCollectionPolicy } from '../engine/benchmark-result.ts';
import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-environment.ts';

export function createBenchmarkExecutionEnvironment(
    policy: BenchmarkGarbageCollectionPolicy | null,
    boundary: 'direct' | 'hosted-worker' | 'supervised-process',
    normalization: BenchmarkNormalizationContext | null
): BenchmarkExecutionEnvironment | null {
    if (policy === null) {
        return null;
    }
    const collect = globalThis.gc;
    return {
        normalization,
        profileGarbageCollection: policy,
        garbageCollection: boundary !== 'direct' && typeof collect === 'function'
            ? {
                kind: 'available',
                collect() {
                    collect();
                }
            }
            : {
                kind: 'unavailable',
                reason: 'Forced garbage collection requires a supervised or hosted benchmark runtime with GC exposed.'
            }
    };
}
