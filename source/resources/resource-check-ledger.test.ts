import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import type { DiffPathSegment } from '../diff/diff-shape.ts';

import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type { ResourceCheckInterval } from '../resource-check-protocol.ts';
import { createResourceCheckLedger, type ResourceCheckLedger } from './resource-check-ledger.ts';

const owner = { run: 'unit', id: 'owner', scope: 'per-case' } as const;
function publish(): void {
    return undefined;
}
const lifetime = { kind: 'lifetime' } as const;
const attempt = {
    kind: 'attempt',
    attempt: { index: 0 },
    work: {
        case: { file: null, suite: [], title: 'consumer', params: null },
        runtimes: [],
        workload: null,
        familyVariant: null
    }
} as const;
const failedCheck: FailedCheck = {
    kind: 'leaf',
    id: 'check',
    source: 'assert',
    sourceLocations: [ { kind: 'unknown' } ],
    actual: { kind: 'boolean', value: false },
    expected: { kind: 'boolean', value: true },
    path: [],
    diff: null,
    summary: 'Owner invariant failed'
};
function ledger(): ResourceCheckLedger {
    return createResourceCheckLedger(
        'service',
        function () {
            return undefined;
        },
        owner,
        publish
    );
}
export const testNode = authoredSuite('resource observation ledger', [
    test('opens each observation interval once', function (scope: TestScope) {
        const checks = ledger();
        checks.open(lifetime);
        checks.open(lifetime);
        scope.assert.deepEqual(checks.snapshots(), [ {
            resource: 'service',
            owner,
            revision: 0,
            interval: lifetime,
            passing: 0,
            failures: [],
            errors: [],
            status: { kind: 'open' }
        } ]);
        return scope.assert.collect();
    }),
    test('counts passing findings separately for lifetime and attempt intervals', function (scope: TestScope) {
        const checks = ledger();
        checks.writer.record(lifetime, null, { kind: 'pass' });
        checks.writer.record(attempt, 'consumer', { kind: 'pass' });
        checks.writer.record(attempt, 'consumer', { kind: 'pass' });
        checks.writer.record({ ...attempt, attempt: { index: 1 } }, 'consumer', { kind: 'pass' });
        scope.assert.deepEqual(
            checks.snapshots().map(function (snapshot) {
                return snapshot.passing;
            }),
            [ 1, 2, 1 ]
        );
        return scope.assert.collect();
    }),
    test('copies findings before retaining them', function (scope: TestScope) {
        const checks = ledger();
        const path: DiffPathSegment[] = [ { kind: 'index', index: 0 } ];
        checks.writer.record(attempt, 'consumer', { kind: 'fail', check: { ...failedCheck, path } });
        path.push({ kind: 'index', index: 1 });
        const snapshot = checks.snapshots()[0];
        scope.require.defined(snapshot);
        scope.assert.equal(snapshot.passing, 0);
        scope.assert.deepEqual(snapshot.failures, [ {
            target: 'consumer',
            check: { ...failedCheck, path: [ { kind: 'index', index: 0 } ] }
        } ]);
        return scope.assert.collect();
    }),
    test('returns snapshots isolated from subsequent observations', function (scope: TestScope) {
        const checks = ledger();
        checks.open(lifetime);
        const before = checks.snapshots();
        checks.writer.record(lifetime, null, { kind: 'pass' });
        scope.assert.equal(before[0]?.passing, 0);
        scope.assert.equal(checks.snapshots()[0]?.passing, 1);
        scope.assert.true(Object.isFrozen(before));
        scope.assert.true(Object.isFrozen(before[0]));
        return scope.assert.collect();
    }),
    test('marks a completed interval incomplete when observation errors were recorded', function (scope: TestScope) {
        const checks = ledger();
        const failure = new Error('Observation failed.');
        checks.writer.error(attempt, 'consumer', failure);
        scope.assert.deepEqual(checks.finalize(attempt, { kind: 'complete' }), {
            kind: 'incomplete',
            reasons: [ 'Observation errors were recorded.' ]
        });
        scope.assert.equal(checks.snapshots()[0]?.errors[0]?.cause, failure);
        return scope.assert.collect();
    }),
    test('retains the first finalization status', function (scope: TestScope) {
        const checks = ledger();
        const incomplete = { kind: 'incomplete', reasons: [ 'Collection interrupted.' ] } as const;
        scope.assert.deepEqual(checks.finalize(lifetime, incomplete), incomplete);
        const snapshot = checks.snapshots()[0];
        scope.require.defined(snapshot);
        Reflect.set(snapshot.status, 'kind', 'complete');
        scope.assert.deepEqual(checks.finalize(lifetime, { kind: 'complete' }), incomplete);
        return scope.assert.collect();
    }),
    test('routes findings after attempt finalization into lifetime observation errors', function (scope: TestScope) {
        const checks = ledger();
        checks.finalize(attempt, { kind: 'complete' });
        checks.writer.record(attempt, 'consumer', { kind: 'fail', check: failedCheck });
        const snapshots = checks.snapshots();
        const error = snapshots[1]?.errors[0];
        scope.require.defined(error);
        scope.assert.deepEqual({ failures: snapshots[0]?.failures, passing: snapshots[0]?.passing }, {
            failures: [],
            passing: 0
        });
        scope.assert.deepEqual(error.interval, attempt);
        scope.assert.includes(String(error.cause), 'Resource check arrived after finalization.');
        return scope.assert.collect();
    }),
    test('marks closed lifetime evidence incomplete when late errors arrive', function (scope: TestScope) {
        const checks = ledger();
        checks.finalize(lifetime, { kind: 'complete' });
        checks.writer.error(lifetime, null, new Error('Late observation.'));
        scope.assert.deepEqual<unknown, unknown>(checks.snapshots()[0]?.status, {
            kind: 'incomplete',
            reasons: [ 'Activity arrived after finalization.' ]
        });
        return scope.assert.collect();
    }),
    test('records stop findings before notifying the owner', function (scope: TestScope) {
        const stopped: { readonly cause: unknown; readonly interval: ResourceCheckInterval; }[] = [];
        const checks = createResourceCheckLedger(
            'service',
            function (cause, interval) {
                stopped.push({ cause, interval });
            },
            owner,
            publish
        );
        const error = new Error('Observation failed.');
        checks.writer.requestStop(attempt, 'consumer', { kind: 'check', check: failedCheck });
        checks.writer.requestStop(lifetime, null, { kind: 'observation-error', error });
        scope.assert.deepEqual(stopped, [ { cause: failedCheck, interval: attempt }, {
            cause: error,
            interval: lifetime
        } ]);
        scope.assert.equal(checks.snapshots()[0]?.failures.length, 1);
        scope.assert.equal(checks.snapshots()[1]?.errors[0]?.cause, error);
        return scope.assert.collect();
    })
]);
