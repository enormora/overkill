import { expect, test } from 'tstyche';
import * as standard from '../test/bench.entry-point.ts';
import * as bench from './bench.entry-point.ts';

test('preserves module samples and authored timeline return types through wrappers', function () {
    bench.benchmark('cold import', {
        kind: 'startup',
        workloads: [ bench.workload('one', {}) ],
        measurement: bench.rawMeasurement(
            bench.timelineMeasurement(bench.moduleMeasurement(), { maximumEvents: 4096 })
        ),
        async measure({ sample }) {
            expect(sample).type.toBe<bench.BenchmarkSample<bench.ModuleSample>>();
            expect(sample).type.not.toHaveProperty('measure');
            expect(sample).type.not.toHaveProperty('process');
            const synchronous = sample.timeline.span('synchronous', function () {
                return 'value';
            });
            expect(synchronous).type.toBe<string>();
            const pending = sample.timeline.span('async', async function () {
                return await Promise.resolve(1);
            });
            expect(pending).type.toBe<Promise<number>>();
            const imported = await sample.importModule({
                url: new URL('./entry.js', import.meta.url),
                cwd: '.',
                env: null,
                nodeArguments: []
            });
            expect(imported).type.toBe<bench.MeasuredModuleImport>();
            return { durationMicroseconds: imported.metrics.durationMicroseconds };
        },
        diagnosticMetrics: [],
        budgets: { one: { durationMicroseconds: { maximum: 1000 } } }
    });
    expect(standard.moduleMeasurement).type.toBe<typeof bench.moduleMeasurement>();
    expect(standard.timelineMeasurement).type.toBe<typeof bench.timelineMeasurement>();
    expect(standard.readBenchmarkTimeline).type.toBe<typeof bench.readBenchmarkTimeline>();
});
