export const normalizedBenchConfigScript = `
import { defineConfig } from '@overkill-dev/test/config';
export const config = defineConfig({
    profiles: {
        normalized: {
            testFamily: 'benchmark',
            files: { include: ['normalization.bench.mjs'] },
            execution: { processModel: 'worker-pool', workerLifecycle: 'reuse' },
            baselines: { directory: 'references', adapters: [] }
        }
    }
});
`;

export const normalizedBenchFixtureScript = `
import {
    availableMetric, benchmark, calibratedMeasurement, defaultSamplingPolicy,
    defineCalibrationResource, wallClockMeasurement, workload
} from '@overkill-dev/test/bench';
const lifecycle = { warmupSamples: 0, cooldown: { mode: 'off' }, garbageCollection: 'off' };
const reference = defineCalibrationResource({
    workload: workload('reference', {}), version: '1', unit: 'ticks', dependencies: {},
    measurement: wallClockMeasurement(),
    measure({ sample }) {
        const measured = sample.measure(() => 200);
        return availableMetric(measured.value, { collector: 'reference', scope: 'region', unit: 'ticks' });
    }
}, { sampling: { ...defaultSamplingPolicy, minimumSamples: 128, maximumSamples: 128 }, lifecycle });
export const testNode = benchmark('normalized metric', {
    kind: 'runtime', workloads: [workload('one', {})],
    measurement: calibratedMeasurement(wallClockMeasurement(), {
        value: { calibration: reference, scaling: 'proportional' }
    }),
    measure({ sample }) { return { value: sample.measure(() => 100).value }; },
    diagnosticMetrics: [],
    budgets: { one: { value: { maximum: 0.75, statistic: { kind: 'observed-maximum' } } } }
}, { sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 },
    lifecycle, annotations: {}, controls: {} });
`;
