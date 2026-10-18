import { benchmark, defaultSamplingPolicy, wallClockMeasurement, workload } from '../../../packages/bench/bench.entry-point.ts';

export const testNode = benchmark('sample cleanup fails', {
    kind: 'runtime',
    workloads: [ workload('one', {}) ],
    measurement: wallClockMeasurement(),
    measure({ sample }) {
        sample.cleanup(() => { throw new Error('Sample cleanup failed.'); });
        return { value: sample.measure(() => 1).value };
    },
    diagnosticMetrics: [],
    budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
}, {
    annotations: {},
    controls: {},
    sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 },
    lifecycle: { garbageCollection: 'after-sample', warmupSamples: 0, cooldown: { mode: 'off' } }
});
