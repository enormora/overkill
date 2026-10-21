import {
    benchmark, defaultSamplingPolicy, defaultBenchmarkLifecyclePolicy,
    moduleMeasurement, timelineMeasurement, rawMeasurement, workload
} from '../../../packages/bench/bench.entry-point.ts';

export const testNode = benchmark('cold module graph', {
    kind: 'startup', workloads: [ workload('one', {}) ],
    measurement: rawMeasurement(timelineMeasurement(moduleMeasurement(), { maximumEvents: 4096 })),
    async measure({ sample }) {
        sample.timeline.mark('prepared');
        sample.cleanup(function () { sample.timeline.mark('reset'); });
        const imported = await sample.timeline.span('authored import', async function () {
            return await sample.importModule({
                url: new URL('./cold-module.test.ts', import.meta.url), cwd: process.cwd(), env: null, nodeArguments: []
            });
        });
        return {
            durationMicroseconds: imported.metrics.durationMicroseconds,
            processStartupMilliseconds: imported.metrics.processStartupMilliseconds
        };
    },
    diagnosticMetrics: [ 'processStartupMilliseconds' ],
    budgets: { one: { durationMicroseconds: { maximum: 5_000_000, statistic: { kind: 'observed-maximum' } } } }
}, {
    annotations: {}, controls: {},
    lifecycle: { ...defaultBenchmarkLifecyclePolicy, warmupSamples: 1 },
    sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
});
