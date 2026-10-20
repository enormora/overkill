import { benchmarkAuthoringExports } from '../../test-support/benchmark-authoring-exports.ts';
import { suite, test } from './test.entry-point.ts';
import * as bench from './bench.entry-point.ts';
import * as baselines from './baselines.entry-point.ts';

export const testNode = suite('benchmark subpaths', [
    test('@overkill-dev/test/bench exposes the leaf authoring surface', function (scope) {
        scope.assert.deepEqual(
            Object.keys(bench).toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            benchmarkAuthoringExports
        );
        return scope.assert.collect();
    }),
    test('@overkill-dev/test/baselines exposes contracts without loading storage', function (scope) {
        scope.assert.deepEqual(Object.keys(baselines), []);
        return scope.assert.collect();
    })
]);
