import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { distributionScale, sampleHistogram, sampleBox } from './benchmark-html-distribution.ts';

export const testNode = suite('benchmark HTML distributions', [
    test('bins every observation and includes both endpoints', function (scope: TestScope) {
        const values = [ -10, 0, 10 ];
        const histogram = sampleHistogram(values, distributionScale([ values ]));
        scope.assert.equal(histogram.length, 20);
        scope.assert.equal(histogram[0], 1);
        scope.assert.equal(histogram.at(-1), 1);
        scope.assert.equal(
            histogram.reduce(function total(sum, count) {
                return sum + count;
            }, 0),
            3
        );
        scope.assert.deepEqual(sampleHistogram([ 0, 0 ], distributionScale([ [ 0, 0 ] ])), [ 2 ]);
        scope.assert.deepEqual(sampleBox([ 4, 1, 3, 2 ]), [ 1, 1.75, 2.5, 3.25, 4 ]);
        scope.assert.deepEqual(sampleBox([]), []);
        return scope.assert.collect();
    })
]);
