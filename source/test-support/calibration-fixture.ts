import type { BenchmarkScope } from '../engine/test-node.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { defaultSamplingPolicy } from '../bench/sampling-policy.ts';

export function calibrationSnapshot(samples: readonly number[]): CalibrationSnapshot {
    return {
        version: 1,
        identity: { workload: { name: 'reference', params: {} }, version: '1', unit: 'ticks' },
        machineClass: 'fixture-machine',
        metadata: {},
        execution: { nodeVersion: '26.9.0', nodeArguments: [] },
        checkpoint: 1,
        sampling: { ...defaultSamplingPolicy, minimumSamples: samples.length, maximumSamples: samples.length },
        lifecycle: { garbageCollection: 'off', warmupSamples: 0, cooldown: { mode: 'off' } },
        samples
    };
}

export function calibrationScope(
    reference: CalibrationSnapshot,
    cleanup: BenchmarkScope['cleanup'],
    signal: AbortSignal
): BenchmarkScope {
    const selectedWorkload = { name: 'one', params: {} };
    const workId = {
        ...createDefaultWorkId(createCaseId('reference.bench.ts', [], 'reference', null)),
        workload: selectedWorkload
    };
    return {
        workId,
        attemptId: { index: 0 },
        workload: selectedWorkload,
        signal,
        cleanup,
        benchmarkEnvironment: {
            profileGarbageCollection: 'off',
            garbageCollection: { kind: 'unavailable', reason: 'GC unavailable' },
            normalization: {
                mode: 'compare',
                executionId: null,
                profile: 'bench',
                machine: {
                    machineClass: reference.machineClass,
                    metadata: reference.metadata
                },
                references: [ reference ],
                saved: []
            }
        },
        reportCleanupError(error) {
            throw new Error('Unexpected calibration cleanup failure.', { cause: error });
        },
        reportError(error) {
            throw error;
        },
        async updateResult() {
            throw new Error('Sampling must not update benchmark results.');
        }
    };
}
