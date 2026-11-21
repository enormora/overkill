import { type TestScope, suite, test } from '@overkill-dev/test';

import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { finalizedResourceCheckResult } from '../engine/resource-check-result.ts';
import { historyRecordSchema } from './history-record.ts';
import { mergeRecordSchema } from './merge-results-schema.ts';
import { recordedRunResult, serializeRunDiagnostics } from './run-record-result.ts';

import { parseRunResult } from './run-result-schema.ts';

const snapshot = {
    owner: { run: 'record-run', id: 'record-owner', scope: 'per-run' },
    resource: 'service',
    revision: 1,
    interval: { kind: 'lifetime' },
    passing: 2,
    failures: [],
    errors: [],
    status: { kind: 'complete' }
} as const;
export const testNode = suite('resource check records', [
    test('round trips owner attribution and bounded observation errors', function (scope) {
        const cause: Record<string, unknown> = { detail: 'observation failed' };
        cause.cycle = cause;
        const resourceChecks = [ {
            ...snapshot,
            errors: [ { interval: snapshot.interval, target: 'service-target', cause } ],
            status: { kind: 'incomplete' as const, reasons: [ 'delivery lost' ] }
        } ];
        const serialized = serializeRunDiagnostics({ ...runResultFactory.build({}), resourceChecks });
        const encoded = JSON.stringify(recordedRunResult({ ...runResultFactory.build({}), resourceChecks }));
        const restored = parseRunResult(JSON.parse(encoded));
        scope.assert.deepEqual({ ...restored.resourceChecks[0]?.owner }, { ...snapshot.owner });
        scope.assert.equal(restored.resourceChecks[0]?.errors[0]?.target, 'service-target');
        scope.assert.deepEqual({
            passing: serialized.resourceChecks[0]?.passing,
            retained: JSON.stringify(serialized).includes('observation failed')
        }, { passing: 2, retained: true });
        return scope.assert.collect();
    }),
    test('requires explicit resource-check evidence in version 1 records', function (scope) {
        const record = mergeRecordFixture('resource-record', 1, 1);
        const result: Record<string, unknown> = { ...record.result };
        delete result.resourceChecks;
        scope.assert.false(
            mergeRecordSchema.safeParse({ ...record, result }).success
        );
        return scope.assert.collect();
    }),
    test('rejects superseded shard and history formats', function (scope) {
        const shard = mergeRecordFixture('shard', 1, 1);
        const history = completedHistoryRecord('history');
        for (const version of [ 2, 3, 4, 5 ]) {
            scope.assert.false(mergeRecordSchema.safeParse({ ...shard, version }).success);
            scope.assert.false(historyRecordSchema.safeParse({ ...history, version }).success);
        }
        return scope.assert.collect();
    }),
    test('history projections retain owner and interval evidence', function (scope: TestScope) {
        const record = completedHistoryRecord('resource-history');
        const decoded = historyRecordSchema.parse({
            ...record,
            result: { ...record.result, resourceChecks: [ snapshot ] }
        });
        const evidence = decoded.result?.resourceChecks[0];
        scope.require.defined(evidence);
        scope.assert.deepEqual({ ...evidence.owner }, { ...snapshot.owner });
        scope.assert.equal(evidence.passing, snapshot.passing);
        scope.assert.deepEqual({ ...evidence.interval }, { ...snapshot.interval });
        return scope.assert.collect();
    }),
    test('historical result decoding supplies an empty resource collection', function (scope) {
        const legacy: Record<string, unknown> = { ...runResultFactory.build({}) };
        delete legacy.resourceChecks;
        scope.assert.deepEqual(parseRunResult(legacy).resourceChecks, []);
        return scope.assert.collect();
    }),
    test('complete observations preserve successful results', function (scope) {
        const original = runResultFactory.build({ status: 'passed', planStatus: 'empty-shard' });
        const result = finalizedResourceCheckResult(original, [ snapshot ]);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(result.resourceChecks[0]?.passing, 2);
        return scope.assert.collect();
    }),
    test('unfinished attempt evidence retains its original case and attempt attribution', function (scope: TestScope) {
        const work = {
            case: { file: 'owned.test.ts', title: 'owned consumer', suite: [], params: null },
            runtimes: [],
            workload: null,
            familyVariant: null
        };
        const interval = { kind: 'attempt' as const, work, attempt: { index: 2 } };
        const original = runResultFactory.build({});
        const result = finalizedResourceCheckResult(original, [ { ...snapshot, interval, status: { kind: 'open' } } ]);
        const error = result.runnerErrors[0];
        scope.require.defined(error);
        scope.assert.deepEqual({
            file: error.attributedTo?.file,
            title: error.attributedTo?.title,
            attempt: error.attributedToAttempt?.index
        }, { file: 'owned.test.ts', title: 'owned consumer', attempt: 2 });
        scope.assert.deepEqual({ ...error.attributedToWork }, work);
        return scope.assert.collect();
    }),
    test('unfinished checkpoints prevent success without changing case counts', function (scope) {
        const original = runResultFactory.build({});
        const result = finalizedResourceCheckResult(original, [ { ...snapshot, status: { kind: 'open' } } ]);
        scope.assert.equal(result.status, 'failed');
        scope.assert.deepEqual(result.summary, original.summary);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'fixture');
        scope.assert.equal(result.resourceChecks[0]?.status.kind, 'incomplete');
        return scope.assert.collect();
    })
]);
