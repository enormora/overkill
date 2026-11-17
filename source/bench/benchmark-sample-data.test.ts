import { suite, test } from '../packages/test/test.entry-point.ts';
import { availableMetric } from './metric-reading.ts';
import { readRawBenchmarkSamples } from './benchmark-sample-data.ts';
import { currentMeasurementContext } from './measurement-context.ts';

const reading = availableMetric(7, { collector: 'custom', scope: 'custom', unit: 'ticks' });
export const testNode = suite('versioned benchmark samples', [
    test('reads historical attachments with absent attribution', function (scope) {
        const parsed = readRawBenchmarkSamples({ value: [ reading ], version: [ reading ] });
        scope.assert.deepEqual(parsed, {
            version: 2,
            metrics: {
                value: [ { reading: structuredClone(reading), attribution: null } ],
                version: [ { reading: structuredClone(reading), attribution: null } ]
            }
        });
        return scope.assert.collect();
    }),
    test('preserves invocation and target identity in current envelopes', function (scope) {
        const context = currentMeasurementContext();
        const attribution = {
            invocation: { ...context.invocation, index: 9 },
            target: { ...context.target.identity, document: 'document-one' }
        };
        const parsed = readRawBenchmarkSamples({ version: 2, metrics: { value: [ { reading, attribution } ] } });
        scope.assert.deepEqual(parsed.metrics['value'] ?? [], [ { reading, attribution } ]);
        return scope.assert.collect();
    }),
    test('rejects unsupported formats instead of treating metadata as metrics', function (scope) {
        scope.assert.throws(function () {
            readRawBenchmarkSamples({ version: 3, metrics: {} });
        }, { type: Error });
        return scope.assert.collect();
    })
]);
