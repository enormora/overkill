import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { captureSnapshot, snapshotComparisonValue } from './snapshot-value.ts';

export const testNode = authoredSuite('snapshot value admission', [
    ...[
        { kind: 'bytes', actual: 'wrong', limit: 100, message: 'Binary snapshots require Uint8Array values.' },
        { kind: 'text', actual: 42, limit: 100, message: 'Text snapshots require string values.' },
        { kind: 'value', actual: 'oversized value', limit: 1, message: 'Snapshot exceeds its byte limit.' },
        { kind: 'value', actual: { a: 1 }, limit: 7, message: 'Snapshot exceeds its byte limit.' }
    ]
        .map(function (scenario) {
            return authoredTest(
                `rejects ${scenario.kind} snapshot ${scenario.message} with limit ${scenario.limit}`,
                function (scope: TestScope) {
                    scope.assert.throws(function () {
                        Reflect.apply(captureSnapshot, undefined, [ {
                            kind: scenario.kind,
                            actual: scenario.actual,
                            name: 'value'
                        }, scenario.limit ]);
                    }, { message: scenario.message });
                    return scope.assert.collect();
                }
            );
        }),
    authoredTest('rejects binary payloads requested as text', function (scope: TestScope) {
        const payload = captureSnapshot({ kind: 'bytes', name: 'value', actual: new Uint8Array([ 1 ]) }, 1);
        scope.assert.throws(function () {
            snapshotComparisonValue(payload, 'text');
        }, { message: 'Snapshot payload does not match its format.' });
        return scope.assert.collect();
    })
]);
