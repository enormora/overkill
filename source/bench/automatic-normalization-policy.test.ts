import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import {
    measurementStrategy,
    processCpuCollector,
    processMeasurement,
    rawMeasurement,
    wallClockMeasurement,
    calibratedMeasurement,
    cpuCalibration
} from '../packages/bench/bench.entry-point.ts';
import { referenceResource } from '../test-support/normalized-machine.ts';
import { normalizationDefinition as definition } from '../test-support/automatic-normalization.ts';

export const testNode = authoredSuite('automatic normalization policy', [
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
    })
]);
