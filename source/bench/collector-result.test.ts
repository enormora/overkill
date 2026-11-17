import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { CollectorCompleteness } from '../engine/measurement-evidence.ts';
import type { MetricCollector, MetricReadings } from './measurement-types.ts';
import { createMeasurementSample } from './measurement-region.ts';
import { measurementStrategy } from './measurement-strategy.ts';
import { availableMetric } from './metric-reading.ts';

const metric = { name: 'count', collector: 'custom', scope: 'custom' as const, unit: 'count' };
function collectorReturning(readings: MetricReadings, completeness: CollectorCompleteness): MetricCollector {
    return {
        name: 'custom',
        version: '1',
        mode: 'sync',
        metrics: [ metric ],
        prepare() {
            return {
                start() {
                    return undefined;
                },
                stop() {
                    return undefined;
                },
                finalize(context) {
                    return { ...context.readings(readings), completeness };
                }
            };
        }
    };
}
export const testNode = suite('collector result admission', [
    test('retains omitted readings as unavailable diagnostics', function (scope: TestScope) {
        const collector = collectorReturning({}, { kind: 'complete' });
        const measured = createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(
            function () {
                return 1;
            }
        );
        const reading = measured.metrics['count'];
        scope.require.defined(reading);
        if (reading.availability !== 'unavailable') {
            throw new Error('Expected an unavailable collector reading.');
        }
        scope.assert.deepEqual(reading, {
            availability: 'unavailable',
            reason: 'Collector omitted the reading.',
            provenance: { collector: 'custom', scope: 'custom', unit: 'count' }
        });
        return scope.assert.collect();
    }),
    test('retains incomplete capture without reasons as unavailable', function (scope: TestScope) {
        const collector = collectorReturning({ count: availableMetric(7, metric) }, {
            kind: 'incomplete',
            reasons: []
        });
        const measured = createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(
            function () {
                return 1;
            }
        );
        const reading = measured.metrics['count'];
        scope.require.defined(reading);
        if (reading.availability !== 'unavailable') {
            throw new Error('Expected an unavailable collector reading.');
        }
        scope.assert.deepEqual(reading, {
            availability: 'unavailable',
            reason: 'Collector evidence is incomplete.',
            provenance: { collector: 'custom', scope: 'custom', unit: 'count' }
        });
        return scope.assert.collect();
    }),
    test('rejects readings outside the declared metric set', function (scope: TestScope) {
        const collector = collectorReturning({ unexpected: availableMetric(7, metric) }, { kind: 'complete' });
        scope.assert.throws(function () {
            createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(function () {
                return 1;
            });
        }, { message: 'Collector returned an undeclared metric.' });
        return scope.assert.collect();
    }),
    test('rejects changes to declared metric provenance', function (scope: TestScope) {
        const collector = collectorReturning({ count: availableMetric(7, { ...metric, unit: 'bytes' }) }, {
            kind: 'complete'
        });
        scope.assert.throws(function () {
            createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(function () {
                return 1;
            });
        }, { message: 'Collector reading changed its declared provenance.' });
        return scope.assert.collect();
    })
]);
