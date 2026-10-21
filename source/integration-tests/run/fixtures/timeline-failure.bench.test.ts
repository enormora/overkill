import {
    benchmark, defaultSamplingPolicy, rawMeasurement, timelineMeasurement, wallClockMeasurement, workload
} from '../../../packages/bench/bench.entry-point.ts';

export const testNode = benchmark('timeline failure', {
    kind: 'runtime', workloads: [ workload('one', {}) ],
    measurement: rawMeasurement(timelineMeasurement(wallClockMeasurement(), { maximumEvents: 64 })),
    measure({ sample }) {
        sample.cleanup(function reset() { sample.timeline.mark('failure cleanup'); });
        sample.measure(function operation() { return 1; });
        return sample.timeline.span('failed body', function fail() { throw new Error('Timeline failure fixture.'); });
    },
    diagnosticMetrics: [], budgets: { one: { value: { maximum: 2 } } }
}, {
    annotations: {}, controls: {},
    sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 },
    lifecycle: { garbageCollection: 'after-sample', warmupSamples: 0, cooldown: { mode: 'off' } }
});
