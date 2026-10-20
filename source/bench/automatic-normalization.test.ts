import {
    benchmark,
    measurementStrategy,
    processCpuCollector,
    processMeasurement,
    wallClockMeasurement,
    rawMeasurement,
    calibratedMeasurement,
    cpuCalibration,
    workload,
    type MeasurementStrategy,
    type ProcessMeasurementStrategy
} from '../packages/bench/bench.entry-point.ts';
import {
    options,
    referenceResource,
    measuredMachine,
    firstBenchmark,
    executeMachine
} from '../test-support/normalized-machine.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createRoot, createTestPlan, execute, type TestCase } from '../packages/engine/engine.entry-point.ts';
import { resolveBenchmarkDefinition, type ResolvedBenchmarkDefinition } from './benchmark-definition-resolution.ts';

function definition(measurement: MeasurementStrategy | ProcessMeasurementStrategy): ResolvedBenchmarkDefinition {
    return resolveBenchmarkDefinition({
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement,
        diagnosticMetrics: [ 'operationsPerSecond', 'bytes' ],
        budgets: { one: { durationMicroseconds: { maximum: 20 }, processCpuTotalMicroseconds: { maximum: 20 } } }
    }, options);
}
function durationBenchmark(garbageCollection: 'after-sample' | 'off'): TestCase {
    return benchmark('automatic duration', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            const measured = sample.measure(function () {
                return 1;
            });
            return { durationMicroseconds: measured.metrics.durationMicroseconds };
        },
        diagnosticMetrics: [],
        budgets: { one: { durationMicroseconds: { maximum: 1000, statistic: { kind: 'observed-maximum' } } } }
    }, { ...options, lifecycle: { ...options.lifecycle, garbageCollection } });
}
export const testNode = suite('automatic benchmark normalization', [
    test(
        'executes automatic CPU normalization directly without runner configuration',
        async function (scope: TestScope) {
            const node = durationBenchmark('off');
            const result = await execute(
                createTestPlan(createRoot({ title: 'automatic', annotations: {}, controls: {}, children: [ node ] }))
            );
            const measured = firstBenchmark(result);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(measured.normalization?.metrics.durationMicroseconds?.source, 'canonical');
            scope.assert.equal(measured.normalization?.calibrations[0]?.identity.workload.name, 'integer-mix');
            return scope.assert.collect();
        }
    ),
    test(
        'preserves existing GC capabilities when adding an automatic calibration context',
        async function (scope: TestScope) {
            let collections = 0;
            const result = await executeMachine(durationBenchmark('after-sample'), {
                normalization: null,
                profileGarbageCollection: 'off',
                garbageCollection: {
                    kind: 'available',
                    collect() {
                        collections += 1;
                    }
                }
            });
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(collections, 128);
            scope.assert.equal(firstBenchmark(result).normalization?.metrics.durationMicroseconds?.source, 'canonical');
            return scope.assert.collect();
        }
    ),
    test('adds CPU references to built-in timing and collector metrics without a wrapper', function (scope: TestScope) {
        const resolved = definition(measurementStrategy([ processCpuCollector() ]));
        scope.assert.deepEqual(
            Object.keys(resolved.normalization).toSorted(function alphabetically(left, right) {
                return left.localeCompare(right);
            }),
            [ 'durationMicroseconds', 'operationsPerSecond', 'processCpuTotalMicroseconds' ]
        );
        scope.assert.equal(resolved.normalization.durationMicroseconds?.calibration, cpuCalibration());
        scope.assert.equal(resolved.normalization.operationsPerSecond?.scaling, 'inverse');
        scope.assert.false(Object.hasOwn(resolved.normalization, 'bytes'));
        return scope.assert.collect();
    }),
    test('does not treat custom units as CPU time merely because the metric name matches', function (scope: TestScope) {
        const collector = processCpuCollector();
        const measurement = measurementStrategy([ {
            ...collector,
            metrics: collector.metrics.map(function customUnit(metric) {
                return { ...metric, unit: 'bytes' };
            })
        } ]);
        const resolved = definition(measurement);
        scope.assert.false(Object.hasOwn(resolved.normalization, 'processCpuTotalMicroseconds'));
        scope.assert.true(Object.hasOwn(resolved.normalization, 'durationMicroseconds'));
        return scope.assert.collect();
    }),
    test(
        'adds CPU references to process strategies and supports explicit raw measurements',
        function (scope: TestScope) {
            const normalized = definition(processMeasurement({ instrumentation: 'node' }));
            const raw = definition(rawMeasurement(wallClockMeasurement()));
            scope.assert.equal(normalized.normalization.processCpuTotalMicroseconds?.scaling, 'proportional');
            scope.assert.deepEqual(raw.normalization, {});
            return scope.assert.collect();
        }
    ),
    test('keeps custom strategy domains instead of overriding them with CPU calibration', function (scope: TestScope) {
        const calibration = referenceResource(100, function () {
            return undefined;
        });
        const strategy = calibratedMeasurement(wallClockMeasurement(), {
            durationMicroseconds: { calibration, scaling: 'proportional' }
        });
        const resolved = definition(strategy);
        scope.assert.deepEqual(Object.keys(resolved.normalization), [ 'durationMicroseconds' ]);
        scope.assert.equal(resolved.normalization.durationMicroseconds?.calibration, calibration);
        return scope.assert.collect();
    }),
    test(
        'uses one cached non-CPU calibration for multiple metrics and needs no captured files',
        async function (scope: TestScope) {
            let samples = 0;
            const result = await measuredMachine(100, 'fast-mac', 1000, function () {
                samples += 1;
            });
            const measured = firstBenchmark(result);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(samples, 128);
            scope.assert.equal(measured.normalization?.metrics.value?.source, 'canonical');
            scope.assert.equal(measured.normalization?.calibrations.length, 1);
            scope.assert.equal(measured.budgets[0]?.estimate, 10);
            scope.assert.equal(measured.metrics.value?.median, 1000);
            return scope.assert.collect();
        }
    ),
    test('shares proportional, inverse and raw budgets across different hardware', async function (scope: TestScope) {
        const fast = await measuredMachine(100, 'fast-mac', 1000, function () {
            return undefined;
        });
        const slow = await measuredMachine(400, 'slow-arm-runner', 4000, function () {
            return undefined;
        });
        const first = firstBenchmark(fast);
        const second = firstBenchmark(slow);
        scope.assert.deepEqual([ fast.status, slow.status ], [ 'passed', 'passed' ]);
        scope.assert.deepEqual(first.budgets, second.budgets);
        scope.assert.equal(second.budgets[0]?.estimate, 10);
        scope.assert.equal(second.normalization?.metrics.value?.budgetReference.machineClass, 'reference-workload');
        scope.assert.equal(second.metrics.value?.median, 4000);
        return scope.assert.collect();
    }),
    test('still detects a real regression on the slower machine', async function (scope: TestScope) {
        const result = await measuredMachine(400, 'slow-arm-runner', 6000, function () {
            return undefined;
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(firstBenchmark(result).budgets[0]?.decision, 'fail');
        scope.assert.equal(firstBenchmark(result).budgets[0]?.estimate, 15);
        return scope.assert.collect();
    })
]);
