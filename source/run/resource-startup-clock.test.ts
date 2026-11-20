import { table, type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { startupClock, startupResource } from '../test-support/resource-startup-clock.ts';
import { isResourceStartupTimeoutError } from './resource-lifecycle-startup-budget.ts';

export const testNode: TestNode = suite('resource startup clock policy', [
    table({
        title: 'does not schedule invalid or absent budget',
        cases: [ [], [ { kind: 'serial' } ], [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: -1 } ], [ {
            kind: 'startup-budget-milliseconds',
            minimumMilliseconds: Number.NaN
        } ], [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: Number.POSITIVE_INFINITY } ] ] as const,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        async test(scope) {
            const requirements = scope.parameters;

            const clock = startupClock();
            const fixture = startupResource(requirements, 'success');
            scope.assert.equal(await fixture.acquire(clock.runtime), 'handle');
            scope.assert.equal(fixture.observed.read(), fixture.parent.signal);
            scope.assert.deepEqual(clock.scheduled, []);
            return scope.assert.collect();
        }
    }),
    test('uses the greatest budget and cancels its timer after acquisition', async function (scope) {
        const clock = startupClock();
        const fixture = startupResource([ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 2 }, {
            kind: 'startup-budget-milliseconds',
            minimumMilliseconds: 7
        } ], 'success');
        scope.assert.equal(await fixture.acquire(clock.runtime), 'handle');
        scope.assert.deepEqual(clock.scheduled, [ 7 ]);
        scope.assert.notEqual(fixture.observed.read(), fixture.parent.signal);
        scope.assert.equal(clock.cancellations(), 1);
        scope.assert.equal(clock.pending(), 0);
        return scope.assert.collect();
    }),
    test(
        'aborts acquisition and brands timeout errors when the clock expires',
        async function (scope: TestScope) {
            const clock = startupClock();
            const fixture = startupResource(
                [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 0 } ],
                'wait'
            );
            const pending = fixture.acquire(clock.runtime);
            clock.expire();
            await scope.assert.rejects(async function () {
                await pending;
            }, { message: 'Resource "database" exceeded startup budget of 0 ms.' });
            const signal = fixture.observed.read();
            scope.require.defined(signal);
            scope.assert.deepEqual({
                aborted: signal.aborted,
                timeout: isResourceStartupTimeoutError(signal.reason),
                parentAborted: fixture.parent.signal.aborted,
                pending: clock.pending()
            }, { aborted: true, timeout: true, parentAborted: false, pending: 0 });
            return scope.assert.collect();
        }
    ),
    test('forwards parent cancellation and removes the startup timer', async function (scope) {
        const clock = startupClock();
        const fixture = startupResource([ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 7 } ], 'wait');
        const pending = fixture.acquire(clock.runtime);
        const error = new Error('cancelled');
        fixture.parent.abort(error);
        await scope.assert.rejects(async function () {
            await pending;
        }, { exact: error });
        scope.assert.equal(clock.cancellations(), 1);
        scope.assert.false(isResourceStartupTimeoutError(error));
        return scope.assert.collect();
    }),
    test('preserves acquisition errors while releasing timer ownership', async function (scope) {
        const clock = startupClock();
        const fixture = startupResource([ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 7 } ], 'error');
        await scope.assert.rejects(async function () {
            await fixture.acquire(clock.runtime);
        }, { exact: fixture.failure });
        scope.assert.equal(clock.pending(), 0);
        scope.assert.equal(clock.cancellations(), 1);
        return scope.assert.collect();
    }),
    table({
        title: 'does not recognize unrelated timeout value',
        cases: [ null, undefined, 42, 'failure', {}, new Error('ordinary') ] as const,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const error = scope.parameters;

            scope.assert.false(isResourceStartupTimeoutError(error));
            return scope.assert.collect();
        }
    })
]);
