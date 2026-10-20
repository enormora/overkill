import { randomUUID } from 'node:crypto';
import type { BenchmarkLifecyclePolicy, ResolvedBenchmarkLifecyclePolicy } from '../engine/benchmark-result.ts';
import { resolveBenchmarkGarbageCollection } from '../engine/benchmark-garbage-collection.ts';
import type { BenchmarkScope } from '../engine/benchmark-node.ts';
import { readBenchmarkMachine } from '../packages/run/benchmark-calibration.entry-point.ts';

export function directBenchmarkEnvironment(scope: BenchmarkScope): BenchmarkScope {
    if (scope.benchmarkEnvironment !== null && scope.benchmarkEnvironment.normalization !== null) {
        return scope;
    }
    const machine = readBenchmarkMachine();
    return {
        ...scope,
        benchmarkEnvironment: {
            profileGarbageCollection: 'off',
            garbageCollection: {
                kind: 'unavailable',
                reason: 'Direct execution does not enable forced garbage collection.'
            },
            ...scope.benchmarkEnvironment,
            normalization: {
                executionId: randomUUID(),
                mode: 'compare',
                profile: 'direct',
                machine,
                references: [],
                saved: []
            }
        }
    };
}

export function benchmarkLifecyclePolicy(
    policy: BenchmarkLifecyclePolicy,
    scope: BenchmarkScope
): ResolvedBenchmarkLifecyclePolicy {
    return {
        ...policy,
        garbageCollection: resolveBenchmarkGarbageCollection(
            policy.garbageCollection,
            scope.benchmarkEnvironment?.profileGarbageCollection ?? 'off'
        )
    };
}
