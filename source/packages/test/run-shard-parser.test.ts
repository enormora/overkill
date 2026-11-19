import { suite, test as authoredTest } from '@overkill-dev/test';

import type { TestScope } from './test.entry-point.ts';
import { parseRunShard } from './run-shard-parser.ts';

export const testNode = suite('shard argument validation', [
    ...[ '', '1', '1/', '/2', '0/2', '1/0', '-1/2', '1/2/3', '1.5/2', '01/2', '1/2 ' ].map(function (value) {
        return authoredTest(`rejects malformed shard ${JSON.stringify(value)}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                parseRunShard(value);
            }, { message: `Run shard must use i/n syntax with positive integers: ${value}` });
            return scope.assert.collect();
        });
    }),
    ...[ '9007199254740992/9007199254740992', '1/9007199254740992' ].map(function (value) {
        return authoredTest(`rejects unsafe shard integers ${value}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                parseRunShard(value);
            }, { message: /must be a positive safe integer/u });
            return scope.assert.collect();
        });
    }),
    authoredTest('enforces the shard index range', function (scope: TestScope) {
        scope.assert.throws(function () {
            parseRunShard('3/2');
        }, { message: 'Shard index must not exceed shard total: 3/2' });
        scope.assert.deepEqual(parseRunShard('2/2'), { index: 2, total: 2 });
        scope.assert.deepEqual(parseRunShard('1/9007199254740991'), { index: 1, total: Number.MAX_SAFE_INTEGER });
        return scope.assert.collect();
    })
]);
