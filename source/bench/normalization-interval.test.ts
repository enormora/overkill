import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { calibrationFactor, normalizeStatisticalInterval, calibrationInterval } from './normalization-interval.ts';
import { evaluateBudgetInterval } from './benchmark-budget.ts';
import { normalizeMetricBudget } from './benchmark-budget-definition.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';

function constantCalibration(value: number): CalibrationSnapshot {
    return calibrationSnapshot(Array.from({ length: 128 }, function referenceSample() {
        return value;
    }));
}
export const testNode = suite('benchmark normalization intervals', [
    test('scales duration and throughput in opposite directions', function (scope: TestScope) {
        const actual = constantCalibration(200);
        const reference = constantCalibration(100);
        const raw = { estimate: 40, lower: 30, upper: 50 };
        scope.assert.deepEqual(
            normalizeStatisticalInterval(raw, { actual, reference, scaling: 'proportional' }, 0.05),
            {
                estimate: 20,
                lower: 15,
                upper: 25
            }
        );
        scope.assert.deepEqual(
            normalizeStatisticalInterval(raw, { actual, reference, scaling: 'inverse' }, 0.05),
            {
                estimate: 80,
                lower: 60,
                upper: 100
            }
        );
        return scope.assert.collect();
    }),
    test('propagates calibration uncertainty instead of passing on the median ratio', function (scope: TestScope) {
        const actual = calibrationSnapshot(Array.from({ length: 128 }, function noisySample(_value, index) {
            return index % 2 === 0 ? 100 : 400;
        }));
        const reference = constantCalibration(125);
        const interval = normalizeStatisticalInterval({ estimate: 120, lower: 120, upper: 120 }, {
            actual,
            reference,
            scaling: 'proportional'
        }, 0.05);
        scope.assert.deepEqual(interval, { estimate: 60, lower: 37.5, upper: 150 });
        const budget = normalizeMetricBudget('value', { maximum: 75, statistic: { kind: 'observed-maximum' } });
        const result = evaluateBudgetInterval(interval, budget, defaultSamplingPolicy);
        scope.assert.equal(result.decision, 'undecided');
        scope.assert.false(result.precise);
        return scope.assert.collect();
    }),
    test('retains negative and unbounded observation intervals', function (scope: TestScope) {
        const actual = constantCalibration(200);
        const reference = constantCalibration(100);
        scope.assert.deepEqual(
            normalizeStatisticalInterval({ estimate: -40, lower: -50, upper: -30 }, {
                actual,
                reference,
                scaling: 'proportional'
            }, 0.05),
            { estimate: -20, lower: -25, upper: -15 }
        );
        const scarce = calibrationSnapshot([ 100, 300 ]);
        const interval = normalizeStatisticalInterval({ estimate: 120, lower: 120, upper: 120 }, {
            actual: scarce,
            reference,
            scaling: 'proportional'
        }, 0.05);
        scope.assert.equal(interval.lower, 0);
        scope.assert.equal(interval.upper, null);
        return scope.assert.collect();
    }),
    test('spends confidence across stopped calibration checkpoints', function (scope: TestScope) {
        const first = calibrationSnapshot(Array.from({ length: 128 }, function increasingSample(_value, index) {
            return index + 1;
        }));
        const later = { ...first, checkpoint: 2, sampling: { ...first.sampling, minimumSamples: 64 } };
        const earlyInterval = calibrationInterval(first, 0.05);
        const lateInterval = calibrationInterval(later, 0.05);
        if (
            earlyInterval.lower === null || lateInterval.lower === null || earlyInterval.upper === null ||
            lateInterval.upper === null
        ) {
            throw new Error('Expected finite calibration intervals.');
        }
        scope.assert.true(lateInterval.lower <= earlyInterval.lower);
        scope.assert.true(lateInterval.upper >= earlyInterval.upper);
        scope.assert.notDeepEqual(lateInterval, earlyInterval);
        return scope.assert.collect();
    }),
    test('preserves uncertainty when the actual and reference snapshots are identical', function (scope: TestScope) {
        const snapshot = constantCalibration(200);
        scope.assert.deepEqual(
            normalizeStatisticalInterval({ estimate: 40, lower: 30, upper: 50 }, {
                actual: snapshot,
                reference: snapshot,
                scaling: 'proportional'
            }, 0.05),
            { estimate: 40, lower: 30, upper: 50 }
        );
        return scope.assert.collect();
    }),
    test('retains zero and absent bounds and makes overflowing bounds unbounded', function (scope: TestScope) {
        const scale = {
            actual: constantCalibration(100),
            reference: constantCalibration(200),
            scaling: 'proportional'
        } as const;
        scope.assert.deepEqual(normalizeStatisticalInterval({ estimate: 0, lower: 0, upper: null }, scale, 0.05), {
            estimate: 0,
            lower: 0,
            upper: null
        });
        scope.assert.deepEqual(
            normalizeStatisticalInterval({ estimate: 0, lower: 0, upper: Number.MAX_VALUE }, scale, 0.05),
            {
                estimate: 0,
                lower: 0,
                upper: null
            }
        );
        return scope.assert.collect();
    }),
    test('rejects ratios outside the finite positive number range', function (scope: TestScope) {
        const actual = constantCalibration(1e200);
        const reference = constantCalibration(1e-200);
        for (const scaling of [ 'proportional', 'inverse' ] as const) {
            scope.assert.throws(function () {
                return calibrationFactor(actual, reference, scaling);
            }, {
                message: 'Normalization factor must be finite and positive.'
            });
        }
        return scope.assert.collect();
    }),
    test('rejects changed calibration identities and execution arguments', function (scope: TestScope) {
        const actual = constantCalibration(200);
        const references = [
            { ...actual, identity: { ...actual.identity, version: 'other' } },
            { ...actual, execution: { ...actual.execution, nodeArguments: [ '--jitless' ] } }
        ];
        for (const reference of references) {
            scope.assert.throws(function () {
                return calibrationFactor(actual, reference, 'proportional');
            }, {
                message: 'Calibration references are not comparable.'
            });
        }
        return scope.assert.collect();
    }),
    test('keeps inverse scaling unbounded when the calibration numerator is uncertain', function (scope: TestScope) {
        scope.assert.deepEqual(
            normalizeStatisticalInterval({ estimate: 40, lower: 30, upper: 50 }, {
                actual: calibrationSnapshot([ 128, 384 ]),
                reference: constantCalibration(128),
                scaling: 'inverse'
            }, 0.05),
            { estimate: 80, lower: 0, upper: null }
        );
        return scope.assert.collect();
    }),
    test('rejects overflow and normalizes across machine classes', function (scope: TestScope) {
        const actual = constantCalibration(200);
        const reference = constantCalibration(100);
        scope.assert.throws(function overflow() {
            return normalizeStatisticalInterval({ estimate: Number.MAX_VALUE, lower: 0, upper: null }, {
                actual,
                reference,
                scaling: 'inverse'
            }, 0.05);
        }, { message: 'Normalized benchmark estimate is not finite.' });
        scope.assert.equal(calibrationFactor(actual, { ...reference, machineClass: 'other' }, 'proportional'), 0.5);
        return scope.assert.collect();
    })
]);
