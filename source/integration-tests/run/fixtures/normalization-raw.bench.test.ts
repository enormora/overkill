import {benchmark, workload, wallClockMeasurement, defaultSamplingPolicy} from '../../../packages/bench/bench.entry-point.ts';
export const testNode = benchmark('raw metric', {
    kind: 'runtime', workloads: [workload('one', {})], measurement: wallClockMeasurement(),
    measure({sample}) {return {value: sample.measure(function rawValue() {return 100;}).value};},
    diagnosticMetrics: [], budgets: {one: {value: {maximum: 200, statistic: {kind: 'observed-maximum'}}}}
}, {annotations: {}, controls: {}, sampling: {...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2}, lifecycle: {garbageCollection: 'off', warmupSamples: 0, cooldown: {mode: 'off'}}});
