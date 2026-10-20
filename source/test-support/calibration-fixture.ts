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
