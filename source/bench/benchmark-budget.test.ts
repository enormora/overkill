import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeMetricBudget } from './benchmark-budget-definition.ts';
import {
    boundedMeanInterval,
    evaluateMetricBudget,
    quantileInterval
} from './benchmark-budget.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';

export const testNode = suite('benchmark confidence intervals', [
    test('uses binomial ranks with one-based order statistics', function (scope) {
        scope.assert.deepEqual(quantileInterval([ 1, 2, 3, 4, 5 ], 0.5, 0.2), {
            estimate: 3,
            lower: 1,
            upper: 5
        });
        scope.assert.deepEqual(quantileInterval([ 1, 2 ], 0.5, 0.05), {
            estimate: 1.5,
            lower: null,
            upper: null
        });
        return scope.assert.collect();
    }),
    test('clips bounded mean uncertainty to the declared range', function (scope) {
        scope.assert.deepEqual(boundedMeanInterval([ -2, 2 ], { minimum: -2, maximum: 2 }, 0.05), {
            estimate: 0,
            lower: -2,
            upper: 2
        });
        scope.assert.deepEqual(boundedMeanInterval([ 4, 4 ], { minimum: 4, maximum: 4 }, 0.05), {
            estimate: 4,
            lower: 4,
            upper: 4
        });
        scope.assert.throws(function () {
            return boundedMeanInterval([ 5, 4 ], { minimum: 0, maximum: 4 }, 0.05);
        }, { type: TypeError });
        return scope.assert.collect();
    }),
    test('uses noncentral binomial ranks and an unbounded upper tail', function (scope) {
        const values = Array.from({ length: 10 }, function (_value, index) {
            return index + 1;
        });
        scope.assert.deepEqual(quantileInterval(values, 0.5, 0.2), { estimate: 5.5, lower: 3, upper: 8 });
        scope.assert.deepEqual(quantileInterval(values, 0.9, 0.2), { estimate: 9.1, lower: 8, upper: null });
        return scope.assert.collect();
    }),
    test('applies the bounded mean radius beyond the clipped small-sample regime', function (scope) {
        const values = Array.from({ length: 100 }, function () {
            return 5;
        });
        const interval = boundedMeanInterval(values, { minimum: 0, maximum: 10 }, 0.05);
        const radius = 70 * Math.log(80) / 297;
        scope.assert.equal(interval.estimate, 5);
        scope.assert.true(Math.abs((interval.lower ?? 0) - (5 - radius)) < 1e-12);
        scope.assert.true(Math.abs((interval.upper ?? 0) - (5 + radius)) < 1e-12);
        return scope.assert.collect();
    }),
    test('keeps threshold overlap undecided and unavailable values explicit', function (scope) {
        const budget = normalizeMetricBudget('value', { maximum: 3 });
        const overlap = evaluateMetricBudget([ 1, 2, 3, 4, 5 ], budget, defaultSamplingPolicy, 0.2);
        scope.assert.equal(overlap.decision, 'undecided');
        scope.assert.false(overlap.precise);
        scope.assert.equal(evaluateMetricBudget([], budget, defaultSamplingPolicy, 0.2).decision, 'unavailable');
        scope.assert.equal(
            evaluateMetricBudget(
                Array.from({ length: 128 }, function () {
                    return 2;
                }),
                budget,
                defaultSamplingPolicy,
                0.025
            )
                .decision,
            'pass'
        );
        scope.assert.equal(
            evaluateMetricBudget(
                Array.from({ length: 128 }, function () {
                    return 4;
                }),
                budget,
                defaultSamplingPolicy,
                0.025
            )
                .decision,
            'fail'
        );
        return scope.assert.collect();
    }),
    test('observed extrema have exact finite-run intervals', function (scope) {
        const budget = normalizeMetricBudget('value', { maximum: 2, statistic: { kind: 'observed-maximum' } });
        const result = evaluateMetricBudget([ -3, 0, 2 ], budget, defaultSamplingPolicy, 0.01);
        scope.assert.equal(result.estimate, 2);
        scope.assert.deepEqual(result.interval, { lower: 2, upper: 2 });
        scope.assert.equal(result.decision, 'pass');
        scope.assert.true(result.precise);
        return scope.assert.collect();
    })
]);
