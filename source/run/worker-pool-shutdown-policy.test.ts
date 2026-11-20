import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { workerPoolShutdown } from '../test-support/worker-pool-shutdown.ts';

export const testNode = authoredSuite('worker pool shutdown ownership', [
    test('registers each worker exit once across repeated task dispatch', async function (scope: TestScope) {
        const fixture = workerPoolShutdown(null, null);
        const worker = fixture.addWorker();
        scope.assert.equal(
            await fixture.pool.run('first', { name: 'runTask', signal: scope.signal, transferList: [] }),
            'first'
        );
        scope.assert.equal(
            await fixture.pool.run('second', { name: 'runTask', signal: scope.signal, transferList: [] }),
            'second'
        );
        scope.assert.equal(worker.listenerCount('exit'), 1);
        worker.emit('exit');
        await fixture.pool.destroy();
        scope.assert.deepEqual(fixture.calls, [ 'run:first:runTask', 'run:second:runTask', 'destroy' ]);
        return scope.assert.collect();
    }),
    test('waits for worker exit after backend destruction completes', async function (scope: TestScope) {
        const fixture = workerPoolShutdown(null, null);
        const worker = fixture.addWorker();
        const shutdown = fixture.startShutdown();
        await Promise.resolve();
        scope.assert.false(shutdown.settled());
        worker.emit('exit');
        await shutdown.finished;
        scope.assert.deepEqual({ settled: shutdown.settled(), listeners: worker.listenerCount('exit') }, {
            settled: true,
            listeners: 0
        });
        return scope.assert.collect();
    }),
    test('observes workers first discovered during shutdown', async function (scope: TestScope) {
        const fixture = workerPoolShutdown(null, null);
        const first = fixture.addWorker();
        const second = fixture.addWorker();
        const pending = fixture.pool.destroy();
        scope.assert.deepEqual([ first.listenerCount('exit'), second.listenerCount('exit') ], [ 1, 1 ]);
        first.emit('exit');
        second.emit('exit');
        await pending;
        scope.assert.deepEqual({ threads: fixture.pool.threads.length, options: fixture.pool.options }, {
            threads: 2,
            options: { isolateWorkers: true, maxThreads: 2 }
        });
        return scope.assert.collect();
    }),
    test('preserves task failures and still observes exiting workers', async function (scope: TestScope) {
        const failure = new Error('worker task failed');
        const fixture = workerPoolShutdown(failure, null);
        const worker = fixture.addWorker();
        await scope.assert.rejects(async function () {
            await fixture.pool.run(null, { name: 'runTask', signal: scope.signal, transferList: [] });
        }, { exact: failure });
        worker.emit('exit');
        await fixture.pool.destroy();
        scope.assert.deepEqual(fixture.calls, [ 'run:null:runTask', 'destroy' ]);
        return scope.assert.collect();
    }),
    test('preserves backend destruction failures for an idle pool', async function (scope: TestScope) {
        const failure = new Error('worker shutdown failed');
        const fixture = workerPoolShutdown(null, failure);
        await scope.assert.rejects(fixture.pool.destroy, { exact: failure });
        scope.assert.deepEqual(fixture.calls, [ 'destroy' ]);
        return scope.assert.collect();
    })
]);
