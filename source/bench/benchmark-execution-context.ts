import type { BenchmarkLifecyclePolicy, ResolvedBenchmarkLifecyclePolicy } from '../engine/benchmark-result.ts';
import { resolveBenchmarkGarbageCollection } from '../engine/benchmark-garbage-collection.ts';
import type { BenchmarkScope } from '../engine/benchmark-node.ts';
import { calibrationMachineClass, readCalibrationHostMetadata } from './calibration-machine.ts';

export function directBenchmarkEnvironment(scope: BenchmarkScope): BenchmarkScope {
    if (scope.benchmarkEnvironment !== null && scope.benchmarkEnvironment.normalization !== null) {
        return scope;
    }
    const metadata = readCalibrationHostMetadata(process.execArgv);
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
                mode: 'compare',
                profile: 'direct',
                machine: { machineClass: calibrationMachineClass(metadata), metadata },
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
