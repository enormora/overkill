import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { mergeRecordSchema } from './merge-results-schema.ts';
import { mergedRunResult } from './merged-run-result.ts';
import { recordedRunResult } from './run-record-result.ts';

export const testNode = createSuite({
    title: 'merged run results',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'retains serialized error causes and failed status',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
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
            }
        }),
        createTestCase({
            title: 'retains global counts and sums shard-local counts and timings',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
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
            }
        }),
        createTestCase({
            title: 'rejects interrupted records',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                scope.assert.equal(
                    mergeRecordSchema
                        .safeParse({ ...mergeRecordFixture('first', 1, 2), status: 'interrupted' })
                        .success,
                    false
                );

                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
