import { suite, test } from '@overkill-dev/test';
import { benchmarkAuthoringExports } from '../../test-support/benchmark-authoring-exports.ts';

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
    test('@overkill-dev/test/baselines exposes shared baseline operations', function (scope) {
        scope.assert.deepEqual(Object.keys(baselines), [
            'baselineIdentityKey',
            'findStaleBaselines',
            'planBaselineChange',
            'snapshot'
        ]);
        return scope.assert.collect();
    })
]);
