import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { startupClock, startupResource } from '../test-support/resource-startup-clock.ts';
import { isResourceStartupTimeoutError } from './resource-lifecycle-startup-budget.ts';

export const testNode = authoredSuite('resource startup clock policy', [
    ...([ [], [ { kind: 'serial' } ], [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: -1 } ], [ {
        kind: 'startup-budget-milliseconds',
        minimumMilliseconds: Number.NaN
    } ], [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: Number.POSITIVE_INFINITY } ] ] as const)
        .map(function (requirements, index) {
            return authoredTest(
                `does not schedule invalid or absent budget ${index}`,
                async function (scope: TestScope) {
                    const clock = startupClock();
                    const fixture = startupResource(requirements, 'success');
                    scope.assert.equal(await fixture.acquire(clock.runtime), 'handle');
                    scope.assert.equal(fixture.observed.read(), fixture.parent.signal);
                    scope.assert.deepEqual(clock.scheduled, []);
                    return scope.assert.collect();
                }
            );
        }),
    authoredTest('uses the greatest budget and cancels its timer after acquisition', async function (scope: TestScope) {
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
    authoredTest(
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
    authoredTest('forwards parent cancellation and removes the startup timer', async function (scope: TestScope) {
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
    authoredTest('preserves acquisition errors while releasing timer ownership', async function (scope: TestScope) {
        const clock = startupClock();
        const fixture = startupResource([ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 7 } ], 'error');
        await scope.assert.rejects(async function () {
            await fixture.acquire(clock.runtime);
        }, { exact: fixture.failure });
        scope.assert.equal(clock.pending(), 0);
        scope.assert.equal(clock.cancellations(), 1);
        return scope.assert.collect();
    }),
    ...([ null, undefined, 42, 'failure', {}, new Error('ordinary') ] as const).map(function (error, index) {
        return authoredTest(`does not recognize unrelated timeout value ${index}`, function (scope: TestScope) {
            scope.assert.false(isResourceStartupTimeoutError(error));
            return scope.assert.collect();
        });
    })
]);
