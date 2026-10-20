import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';

const referenceSamples = 128;
export function canonicalCalibration(actual: CalibrationSnapshot): CalibrationSnapshot {
    return {
        version: 1,
        identity: actual.identity,
        machineClass: 'reference-workload',
        metadata: { kind: 'canonical-calibration-unit' },
        execution: { nodeVersion: 'canonical', nodeArguments: actual.execution.nodeArguments },
        sampling: { ...defaultSamplingPolicy, minimumSamples: referenceSamples, maximumSamples: referenceSamples },
        lifecycle: { garbageCollection: 'off', warmupSamples: 0, cooldown: { mode: 'off' } },
        checkpoint: 1,
        samples: Array.from({ length: referenceSamples }, function referenceUnit() {
            return 1;
        })
    };
}
