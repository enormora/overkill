import { suite, test } from '@overkill-dev/test';

import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { mergeRecordSchema } from './merge-results-schema.ts';
import { mergedRunResult } from './merged-run-result.ts';
import { recordedRunResult } from './run-record-result.ts';

export const testNode = suite('merged run results', [
    test('keeps an empty shard successful when no shard selected work', function (scope) {
        const record = mergeRecordFixture('empty', 1, 0);
        const result = mergedRunResult([ {
            path: '/empty',
            record: { ...record, result: { ...record.result, planStatus: 'empty-shard' } }
        } ]);
        scope.assert.equal(result.planStatus, 'empty-shard');
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.summary.planned, 0);
        return scope.assert.collect();
    }),
    test('retains empty-selection failure when every shard selected no tests', function (scope) {
        const first = mergeRecordFixture('first', 1, 0);
        const second = mergeRecordFixture('second', 2, 0);
        const result = mergedRunResult([ {
            path: '/first',
            record: { ...first, result: { ...first.result, planStatus: 'empty-shard' } }
        }, {
            path: '/second',
            record: { ...second, result: { ...second.result, planStatus: 'empty-selection' } }
        } ]);
        scope.assert.equal(result.planStatus, 'empty-selection');
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.planned, 0);
        return scope.assert.collect();
    }),
    test('retains serialized error causes and failed status', function (scope) {
        const record = mergeRecordFixture('failed', 1, 1);
        const result = recordedRunResult({
            ...record.result,
            status: 'failed',
            runnerErrors: [ {
                attributedTo: null,
                attributedToWork: null,
                attributedToAttempt: null,
                cause: new Map([ [ 'value', 42n ] ]),
                diagnostics: [],
                message: 'failure',
                subtype: 'crash'
            } ]
        });
        const encoded = JSON.stringify({ ...record, result });
        const decoded = mergeRecordSchema.parse(JSON.parse(encoded));
        const merged = mergedRunResult([ { path: '/failed', record: decoded } ]);
        scope.assert.deepEqual(merged.runnerErrors, result.runnerErrors);
        scope.assert.equal(merged.status, 'failed');
        return scope.assert.collect();
    }),
    test('retains global counts and sums shard-local counts and timings', function (scope) {
        const result = mergedRunResult([ { path: '/first', record: mergeRecordFixture('first', 1, 2) }, {
            path: '/second',
            record: mergeRecordFixture('second', 2, 3)
        } ]);

        scope.assert.equal(result.summary.defined, 10);
        scope.assert.equal(result.summary.discovered, 8);
        scope.assert.equal(result.summary.planned, 5);
        scope.assert.equal(result.summary.passed, 5);
        scope.assert.deepEqual(result.bySuite, { suite: { discovered: 8, executed: 5, planned: 5 } });
        scope.assert.equal(result.timings.summary.totalWallTimeMicroseconds, 20);
        scope.assert.equal(result.processUsage, null);

        return scope.assert.collect();
    }),
    test('rejects interrupted records', function (scope) {
        scope.assert.equal(
            mergeRecordSchema
                .safeParse({ ...mergeRecordFixture('first', 1, 2), status: 'interrupted' })
                .success,
            false
        );

        return scope.assert.collect();
    })
]);
