import { suite as authoredSuite, test } from '@overkill-dev/test';

import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { MeasurementComparisonIdentity } from '../engine/measurement-evidence.ts';
import { performanceBaselineIdentity, type StoredPerformanceBaseline } from './performance-baseline.ts';
import { performanceBaselineKey } from './performance-store.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';

const measurement: MeasurementComparisonIdentity = {
    target: {
        name: 'node',
        version: '26',
        scope: 'executing-runtime',
        clock: 'monotonic',
        semantics: { cache: 'warm' }
    },
    collectors: [ {
        name: 'custom',
        version: '1',
        metrics: [ { name: 'count', collector: 'custom', scope: 'custom', unit: 'count' } ]
    } ]
};
function baselineFor(identity: MeasurementComparisonIdentity): StoredPerformanceBaseline {
    return {
        version: 1,
        measurement: identity,
        normalization: null,
        adapter: 'duration',
        profile: 'bench',
        subtype: 'performance-baseline',
        work: createDefaultWorkId(createCaseId('bench.ts', [], 'work', null)),
        expected: { calibration: { kind: 'comparable', machineClass: 'host', context: {}, metadata: {} }, value: 7 }
    };
}
export const testNode = authoredSuite('measurement comparison identity', [
    test('retains stable measurement facts in versioned baselines', function (scope) {
        const baseline = baselineFor(measurement);
        const encoded = JSON.stringify(baseline);
        const serialized: unknown = JSON.parse(encoded);
        scope.assert.partialDeepEqual(serialized, { version: 1 });
        const restored = storedPerformanceBaselineSchema.parse(serialized);
        scope.assert.deepEqual(restored, baseline);
        scope.assert.equal(typeof performanceBaselineIdentity(restored).measurement, 'string');
        return scope.assert.collect();
    }),
    test('changes comparison keys when cache policy or collector versions change', function (scope) {
        const original = performanceBaselineKey(performanceBaselineIdentity(baselineFor(measurement)));
        const cold = { ...measurement, target: { ...measurement.target, semantics: { cache: 'cold' } } };
        const collectorVersion = {
            ...measurement,
            collectors: measurement.collectors.map(function nextVersion(collector) {
                return { ...collector, version: '2' };
            })
        };
        scope.assert.notEqual(performanceBaselineKey(performanceBaselineIdentity(baselineFor(cold))), original);
        scope.assert.notEqual(
            performanceBaselineKey(performanceBaselineIdentity(baselineFor(collectorVersion))),
            original
        );
        return scope.assert.collect();
    }),
    test('rejects instance IDs inside persisted comparison identity', function (scope) {
        const baseline = baselineFor(measurement);
        scope.assert.throws(function () {
            storedPerformanceBaselineSchema.parse({
                ...baseline,
                measurement: { ...measurement, target: { ...measurement.target, instance: 'changing-session' } }
            });
        }, { type: Error });
        return scope.assert.collect();
    })
]);
