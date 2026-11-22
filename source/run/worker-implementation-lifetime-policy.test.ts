import { suite, test } from '@overkill-dev/test';

import {
    workerImplementationLifetime,
    healthyImplementationLease,
    aggregateLeaseFailure
} from '../test-support/worker-implementation-lifetime.ts';

export const testNode = suite('worker implementation lease ownership', [
    test('runs inline plans without creating a body lease', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        const result = await fixture.lifetime.with('worker', fixture.inline, async function (plan) {
            return plan.root.title;
        });
        scope.assert.equal(result, 'inline');
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('retains admitted leases until their worker is closed', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        const result = await fixture.lifetime.with('worker', fixture.plan, async function (plan) {
            return plan.root.title;
        });
        scope.assert.equal(result, 'references');
        await fixture.lifetime.run('worker', async function () {
            return 42;
        });
        await fixture.lifetime.close('worker');
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events, [ 'start:1', 'enter:1', 'leave:1', 'enter:1', 'leave:1', 'close:1' ]);
        return scope.assert.collect();
    }),
    test('nests retained leases and closes them in reverse admission order', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        await fixture.lifetime.with('worker', fixture.plan, async function () {
            return undefined;
        });
        await fixture.lifetime.with('worker', fixture.plan, async function () {
            return undefined;
        });
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events, [
            'start:1',
            'enter:1',
            'leave:1',
            'start:2',
            'enter:1',
            'enter:2',
            'leave:2',
            'leave:1',
            'close:2',
            'close:1'
        ]);
        return scope.assert.collect();
    }),
    test('closes only the failed assignment while retaining older leases', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        await fixture.lifetime.with('worker', fixture.plan, async function () {
            return undefined;
        });
        const failure = new Error('assignment failed');
        await scope.assert.rejects(async function () {
            await fixture.lifetime.with('worker', fixture.plan, async function () {
                throw failure;
            });
        }, { exact: failure });
        await fixture.lifetime.run('worker', async function () {
            return undefined;
        });
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events.slice(-4), [ 'close:2', 'enter:1', 'leave:1', 'close:1' ]);
        return scope.assert.collect();
    }),
    test('removes a failed first lease before later work', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        const failure = new Error('assignment failed');
        await scope.assert.rejects(async function () {
            await fixture.lifetime.with('worker', fixture.plan, async function () {
                throw failure;
            });
        }, { exact: failure });
        await fixture.lifetime.run('worker', async function () {
            return undefined;
        });
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events, [ 'start:1', 'enter:1', 'leave:1', 'close:1' ]);
        return scope.assert.collect();
    }),
    test('preserves admission failures without retaining a lease', async function (scope) {
        const failure = new Error('admission failed');
        const fixture = workerImplementationLifetime({ ...healthyImplementationLease, start: failure });
        await scope.assert.rejects(async function () {
            await fixture.lifetime.with('worker', fixture.plan, async function () {
                return undefined;
            });
        }, { exact: failure });
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('reports every close failure and still releases all leases', async function (scope) {
        const failure = new Error('close failed');
        const fixture = workerImplementationLifetime({ ...healthyImplementationLease, close: failure });
        await fixture.lifetime.with('worker', fixture.plan, async function () {
            return undefined;
        });
        await fixture.lifetime.with('worker', fixture.plan, async function () {
            return undefined;
        });
        const caught = await aggregateLeaseFailure(async function () {
            await fixture.lifetime.close('worker');
        });
        scope.assert.equal(caught.message, 'Implementation cleanup failed.');
        scope.assert.deepEqual(caught.errors, [ failure, failure ]);
        await fixture.lifetime.close('worker');
        scope.assert.deepEqual(fixture.events.slice(-2), [ 'close:2', 'close:1' ]);
        return scope.assert.collect();
    }),
    test('preserves execution and failed-lease cleanup errors together', async function (scope) {
        const failure = new Error('close failed');
        const work = new Error('work failed');
        const fixture = workerImplementationLifetime({ ...healthyImplementationLease, close: failure });
        const caught = await aggregateLeaseFailure(async function () {
            await fixture.lifetime.with('worker', fixture.plan, async function () {
                throw work;
            });
        });
        scope.assert.equal(caught.message, 'Implementation execution and cleanup failed.');
        scope.assert.deepEqual(caught.errors, [ work, failure ]);
        scope.assert.equal(caught.cause, failure);
        await fixture.lifetime.close('worker');
        return scope.assert.collect();
    }),
    test('keeps worker keys independent', async function (scope) {
        const fixture = workerImplementationLifetime(healthyImplementationLease);
        await fixture.lifetime.with('first', fixture.plan, async function () {
            return undefined;
        });
        await fixture.lifetime.with('second', fixture.plan, async function () {
            return undefined;
        });
        await fixture.lifetime.close('first');
        await fixture.lifetime.run('second', async function () {
            return undefined;
        });
        await fixture.lifetime.close('second');
        scope.assert.deepEqual(fixture.events.slice(-4), [ 'close:1', 'enter:2', 'leave:2', 'close:2' ]);
        return scope.assert.collect();
    })
]);
