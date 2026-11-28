import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import * as standard from '../test/bench.entry-point.ts';
import { defineResource } from '../resources/resources.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import * as bench from './bench.entry-point.ts';

export const testNode = suite('calibrated measurement inference', [
    test('preserves synchronous sample inference', function (scope) {
        const measurement = bench.calibratedMeasurement(bench.wallClockMeasurement(), {
            durationMicroseconds: { calibration: bench.cpuCalibration(), scaling: 'proportional' }
        });
        bench.benchmark('calibrated', {
            kind: 'runtime',
            workloads: [ bench.workload('one', {}) ],
            measurement,
            measure({ sample }) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkSample<bench.MeasurementSample>>()(sample)
                );
                return sample
                    .measure(function readReference() {
                        return 1;
                    })
                    .metrics;
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<typeof bench.calibratedMeasurement>()(standard.calibratedMeasurement)
        );
        return scope.assert.collect();
    }),
    test('preserves asynchronous and process sample inference', function (scope) {
        const calibration = bench.cpuCalibration();
        const asyncStrategy = bench.calibratedMeasurement(bench.asyncMeasurementStrategy([]), {
            value: { calibration, scaling: 'inverse' }
        });
        bench.benchmark('async', {
            kind: 'runtime',
            workloads: [ bench.workload('one', {}) ],
            measurement: asyncStrategy,
            measure({ sample }) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkSample<bench.AsyncMeasurementSample>>()(sample)
                );
                return { value: 1 };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 100 } } }
        });
        const processStrategy = bench.calibratedMeasurement(bench.processMeasurement({ instrumentation: 'off' }), {
            durationMicroseconds: { calibration, scaling: 'proportional' }
        });
        bench.benchmark('process', {
            kind: 'startup',
            workloads: [ bench.workload('one', {}) ],
            measurement: processStrategy,
            measure({ sample }) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkSample<bench.ProcessSample>>()(sample)
                );
                return { durationMicroseconds: 1 };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
        return scope.assert.collect();
    }),
    test('infers ordinary calibration dependencies', function (scope) {
        const value = defineResource({
            name: 'value',
            scope: 'shared-per-worker',
            dependencies: {},
            requirements: [],
            dispose: null,
            acquire() {
                return 1;
            }
        });
        bench.defineCalibrationResource({
            workload: bench.workload('reference', {}),
            version: '1',
            unit: 'microseconds',
            dependencies: { value },
            measurement: bench.wallClockMeasurement(),
            measure({ dependencies, sample }) {
                scope.assert(sameType.withActual<number>(), dependencies.value);
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkSample<bench.MeasurementSample>>()(sample)
                );
                return sample
                    .measure(function readReference() {
                        return dependencies.value;
                    })
                    .metrics
                    .durationMicroseconds;
            }
        });
        return scope.assert.collect();
    })
]);
