import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { assignableFrom, sameType } from '@overkill-dev/type-test';
import * as standard from '../test/bench.entry-point.ts';
import * as bench from './bench.entry-point.ts';

const calibration = bench.cpuCalibration();
const strategies = [
    standard.timelineMeasurement(standard.rawMeasurement(standard.moduleMeasurement()), { maximumEvents: 64 }),
    standard.timelineMeasurement(
        standard.calibratedMeasurement(standard.moduleMeasurement(), {
            durationMicroseconds: { calibration, scaling: 'proportional' }
        }),
        { maximumEvents: 64 }
    ),
    standard.calibratedMeasurement(standard.timelineMeasurement(standard.moduleMeasurement(), { maximumEvents: 64 }), {
        durationMicroseconds: { calibration, scaling: 'proportional' }
    })
] as const;

export const testNode = suite('module', [
    test('preserves module sample inference through composed standard exports', function (typeScope) {
        const measurement = strategies[0] as (typeof strategies)[number];
        standard.benchmark('composed import', {
            kind: 'startup',
            workloads: [ standard.workload('one', {}) ],
            measurement,
            async measure({ sample }) {
                typeScope.assert(sameType.withActual<bench.BenchmarkSample<bench.ModuleSample>>(), sample);
                typeScope.assert(assignableFrom.not<keyof typeof sample, 'measure'>());
                typeScope.assert(assignableFrom.not<keyof typeof sample, 'process'>());
                const imported = await sample.importModule({
                    url: new URL('./entry.js', import.meta.url),
                    cwd: '.',
                    env: null,
                    nodeArguments: []
                });
                return { durationMicroseconds: imported.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 1 } } }
        });
        return typeScope.assert.collect();
    }),
    test('preserves module samples and authored timeline return types through wrappers', function (typeScope) {
        bench.benchmark('cold import', {
            kind: 'startup',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.rawMeasurement(
                bench.timelineMeasurement(bench.moduleMeasurement(), { maximumEvents: 4096 })
            ),
            async measure({ sample }) {
                typeScope.assert(sameType.withActual<bench.BenchmarkSample<bench.ModuleSample>>(), sample);
                typeScope.assert(assignableFrom.not<keyof typeof sample, 'measure'>());
                typeScope.assert(assignableFrom.not<keyof typeof sample, 'process'>());
                const synchronous = sample.timeline.span('synchronous', function () {
                    return 'value';
                });
                typeScope.assert(sameType.withActual<string>(), synchronous);
                const pending = sample.timeline.span('async', async function () {
                    return await Promise.resolve(1);
                });
                typeScope.assert(sameType.withActual<Promise<number>>(), pending);
                const imported = await sample.importModule({
                    url: new URL('./entry.js', import.meta.url),
                    cwd: '.',
                    env: null,
                    nodeArguments: []
                });
                typeScope.assert(sameType.withActual<bench.MeasuredModuleImport>(), imported);
                return { durationMicroseconds: imported.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 1000 } } }
        });
        typeScope.assert(sameType.withActual<typeof bench.moduleMeasurement>(), standard.moduleMeasurement);
        typeScope.assert(sameType.withActual<typeof bench.timelineMeasurement>(), standard.timelineMeasurement);
        typeScope.assert(
            sameType<IsEqual<typeof standard.readBenchmarkTimeline, typeof bench.readBenchmarkTimeline>, true>()
        );
        return typeScope.assert.collect();
    })
]);
