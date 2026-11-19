import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { observationCase } from './test-support/observation-lifetime.ts';
import { withExecutionOwner } from './execution-ownership.ts';
import {
    resourceCheckRunIdentity,
    withResourceCheckCancellation,
    stopResourceCheckAttempt,
    stopResourceCheckWork
} from './resource-check-cancellation.ts';

export const testNode = authoredSuite('resource check cancellation ownership', [
    test('stops only matching work and preserves outer attempt registrations', async function (scope: TestScope) {
        const work = observationCase().workId;
        const peer = { ...work, case: { ...work.case, title: 'peer' } };
        const calls: string[] = [];
        const run = resourceCheckRunIdentity();
        await withResourceCheckCancellation(work, { index: 0 }, function () {
            calls.push('outer');
        }, async function () {
            await withResourceCheckCancellation(work, { index: 1 }, function () {
                calls.push('inner');
            }, async function () {
                await withResourceCheckCancellation(peer, { index: 0 }, function () {
                    calls.push('peer');
                }, async function () {
                    stopResourceCheckWork(work, 'stop work', run);
                    stopResourceCheckAttempt(work, { index: 99 }, 'missing attempt', run);
                    stopResourceCheckWork(work, 'foreign run', Symbol('foreign run'));
                });
            });
            stopResourceCheckAttempt(work, { index: 0 }, 'stop outer', run);
        });
        stopResourceCheckWork(work, 'released work', run);
        stopResourceCheckAttempt(work, { index: 0 }, 'released attempt', run);
        scope.assert.deepEqual(calls, [ 'outer', 'inner', 'outer' ]);
        return scope.assert.collect();
    }),
    test('uses a stable unowned identity outside a run observation', function (scope: TestScope) {
        const active = resourceCheckRunIdentity();
        const unowned = withExecutionOwner({ kind: 'infrastructure', run: null }, resourceCheckRunIdentity);
        scope.assert.notEqual(unowned, active);
        scope.assert.equal(
            withExecutionOwner({ kind: 'infrastructure', run: null }, resourceCheckRunIdentity),
            unowned
        );
        return scope.assert.collect();
    })
]);
