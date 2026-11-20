import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { superviseResourceObservation } from './resource-check-supervision.ts';

export const testNode = authoredSuite('resource observation deadlines', [
    test('returns completed observation values and removes its timer', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const signals: AbortSignal[] = [];
        const result = await superviseResourceObservation(
            function (signal) {
                signals.push(signal);
                return 42;
            },
            scope.signal,
            10,
            clock
        );
        scope.assert.equal(result, 42);
        clock.advanceByMilliseconds(20);
        scope.assert.false(signals[0]?.aborted);
        return scope.assert.collect();
    }),
    test('rejects work that completes after consuming its deadline', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const completion = superviseResourceObservation(
            function () {
                clock.advanceByMilliseconds(10);
                return 42;
            },
            scope.signal,
            10,
            clock
        );
        const [ result ] = await Promise.allSettled([ completion ]);
        scope.require.defined(result);
        scope.assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') {
            scope.assert.includes(String(result.reason), 'Resource observation deadline exceeded.');
        }
        return scope.assert.collect();
    }),
    test('attempts zero-budget cleanup with an aborted signal', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const aborted: boolean[] = [];
        const completion = superviseResourceObservation(
            function (signal) {
                aborted.push(signal.aborted);
            },
            scope.signal,
            0,
            clock
        );
        const [ result ] = await Promise.allSettled([ completion ]);
        scope.require.defined(result);
        scope.assert.equal(result.status, 'rejected');
        scope.assert.deepEqual(aborted, [ true ]);
        return scope.assert.collect();
    }),
    test('propagates observation failures and releases deadline ownership', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const failure = new Error('Observation failed.');
        const completion = superviseResourceObservation(
            function () {
                throw failure;
            },
            scope.signal,
            10,
            clock
        );
        const [ result ] = await Promise.allSettled([ completion ]);
        scope.require.defined(result);
        scope.assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') {
            scope.assert.equal(result.reason, failure);
        }
        clock.advanceByMilliseconds(20);
        return scope.assert.collect();
    }),
    test('rejects a pending observation when its parent is cancelled', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const controller = new AbortController();
        const completion = superviseResourceObservation(
            async function (signal) {
                const cancelled = Promise.withResolvers<undefined>();
                signal.addEventListener('abort', function () {
                    cancelled.resolve(undefined);
                }, { once: true });
                await cancelled.promise;
                signal.throwIfAborted();
            },
            controller.signal,
            10,
            clock
        );
        controller.abort(new Error('Owner stopped.'));
        const [ result ] = await Promise.allSettled([ completion ]);
        scope.require.defined(result);
        scope.assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') {
            scope.assert.equal(result.reason, controller.signal.reason);
        }
        return scope.assert.collect();
    })
]);
