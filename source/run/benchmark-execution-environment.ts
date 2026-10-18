import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-garbage-collection.ts';
import type { BenchmarkGarbageCollectionPolicy } from '../engine/benchmark-result.ts';

export function createBenchmarkExecutionEnvironment(
    policy: BenchmarkGarbageCollectionPolicy | null,
    boundary: 'direct' | 'hosted-worker' | 'supervised-process'
): BenchmarkExecutionEnvironment | null {
    if (policy === null) {
        return null;
    }
    const collect = globalThis.gc;
    return {
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
