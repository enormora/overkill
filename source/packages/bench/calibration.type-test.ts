import { describe, expect, test } from 'tstyche';
import * as standard from '../test/bench.entry-point.ts';
import { defineResource } from '../resources/resources.entry-point.ts';
import * as bench from './bench.entry-point.ts';

describe('calibrated measurement inference', function () {
    test('preserves synchronous sample inference', function () {
        const measurement = bench.calibratedMeasurement(bench.wallClockMeasurement(), {
            durationMicroseconds: { calibration: bench.cpuCalibration(), scaling: 'proportional' }
        });
        bench.benchmark('calibrated', {
            kind: 'runtime',
            workloads: [ bench.workload('one', {}) ],
            measurement,
            measure({ sample }) {
                expect(sample).type.toBe<bench.BenchmarkSample<bench.MeasurementSample>>();
                return sample
                    .measure(function readReference() {
                        return 1;
                    })
                    .metrics;
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
        expect(standard.calibratedMeasurement).type.toBe<typeof bench.calibratedMeasurement>();
    });
    test('preserves asynchronous and process sample inference', function () {
        const calibration = bench.cpuCalibration();
        const asyncStrategy = bench.calibratedMeasurement(bench.asyncMeasurementStrategy([]), {
            value: { calibration, scaling: 'inverse' }
        });
        bench.benchmark('async', {
            kind: 'runtime',
            workloads: [ bench.workload('one', {}) ],
            measurement: asyncStrategy,
            measure({ sample }) {
                expect(sample).type.toBe<bench.BenchmarkSample<bench.AsyncMeasurementSample>>();
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
                expect(sample).type.toBe<bench.BenchmarkSample<bench.ProcessSample>>();
                return { durationMicroseconds: 1 };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
    });
    test('infers ordinary calibration dependencies', function () {
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
                expect(dependencies.value).type.toBe<number>();
                expect(sample).type.toBe<bench.BenchmarkSample<bench.MeasurementSample>>();
                return sample
                    .measure(function readReference() {
                        return dependencies.value;
                    })
                    .metrics
                    .durationMicroseconds;
            }
        });
    });
});
