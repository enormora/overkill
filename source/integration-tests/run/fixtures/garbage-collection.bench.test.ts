import { benchmark, defaultSamplingPolicy, wallClockMeasurement, workload, suite, type BenchmarkGarbageCollectionRequest } from '../../../packages/bench/bench.entry-point.ts';

function definition(garbageCollection: BenchmarkGarbageCollectionRequest) {
    return benchmark(garbageCollection, {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            return { value: sample.measure(() => 1).value, exposed: typeof globalThis.gc === 'function' ? 1 : 0 };
        },
        diagnosticMetrics: [ 'exposed' ],
        budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
    }, {
        lifecycle: { garbageCollection, warmupSamples: 1, cooldown: { mode: 'off' } },
        annotations: {}, controls: {},
        sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
    });
}

export const testNode = suite('GC policy', [ definition('after-sample'), definition('off'), definition('profile-default') ]);
