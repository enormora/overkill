import type { ThrownMatcher } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import {
    createAsyncControlState,
    registerCleanup,
    runCleanups,
    startInFlight,
    validateInFlightTasks,
    type AsyncControlState
} from './async-control.ts';

type RejectionChecks = {
    readonly rejects: (thunk: () => PromiseLike<unknown>, matcher: ThrownMatcher) => Promise<void>;
};
function rejectionAssertions(rejects: TestScope['assert']['rejects']): RejectionChecks {
    return {
        async rejects(thunk, matcher) {
            await rejects<ThrownMatcher>(thunk, matcher);
        }
    };
}

async function settleRecords(state: AsyncControlState): Promise<void> {
    await Promise.all(
        state.inFlightRecords().map(async function (record) {
            return record.settlement;
        })
    );
}
export const testNode = suite('asynchronous task ownership', [
    test('runs registered cleanups once in reverse registration order', async function (scope) {
        const state = createAsyncControlState();
        const calls: number[] = [];
        registerCleanup(state, function () {
            calls.push(1);
        });
        registerCleanup(state, async function () {
            calls.push(2);
        });
        scope.assert.deepEqual(await runCleanups(state), []);
        scope.assert.deepEqual(await runCleanups(state), []);
        scope.assert.deepEqual(calls, [ 2, 1 ]);
        scope.assert.true(state.cleanupStarted());
        return scope.assert.collect();
    }),
    test('continues cleanup after failures and preserves original errors', async function (scope) {
        const state = createAsyncControlState();
        const failure = new Error('Cleanup failed.');
        const calls: string[] = [];
        registerCleanup(state, function () {
            calls.push('earlier');
        });
        registerCleanup(state, function () {
            throw failure;
        });
        const failures = await runCleanups(state);
        scope.assert.equal(failures[0], failure);
        scope.assert.deepEqual(calls, [ 'earlier' ]);
        return scope.assert.collect();
    }),
    test('rejects new cleanup and task ownership after cleanup starts', function (scope) {
        const state = createAsyncControlState();
        state.startCleanup();
        scope.assert.throws(function () {
            registerCleanup(state, function () {
                return undefined;
            });
        }, { message: 'scope.cleanup() cannot be called after test cleanup has started.' });
        scope.assert.throws(function () {
            startInFlight(state, rejectionAssertions(scope.assert.rejects), async function () {
                return 42;
            });
        }, { message: 'scope.startInFlight() cannot be called after test cleanup has started.' });
        scope.assert.deepEqual(state.inFlightRecords(), []);
        return scope.assert.collect();
    }),
    test('tracks a successful task until it is awaited', async function (scope) {
        const state = createAsyncControlState();
        const task = startInFlight(state, rejectionAssertions(scope.assert.rejects), async function () {
            return 42;
        });
        scope.assert.equal(await task.wait(), 42);
        await settleRecords(state);
        scope.assert.deepEqual(validateInFlightTasks(state), []);
        scope.assert.deepEqual(state.inFlightRecords(), []);
        return scope.assert.collect();
    }),
    test('records assertions about task rejections as observation', async function (scope) {
        const state = createAsyncControlState();
        const task = startInFlight(state, rejectionAssertions(scope.assert.rejects), async function () {
            throw new Error('Task failed.');
        });
        await task.rejects({ type: Error, message: 'Task failed.' });
        await settleRecords(state);
        scope.assert.deepEqual(validateInFlightTasks(state), []);
        return scope.assert.collect();
    }),
    test('retains synchronous operation failures through the task promise', async function (scope) {
        const state = createAsyncControlState();
        const failure = new Error('Operation failed.');
        const task = startInFlight(state, rejectionAssertions(scope.assert.rejects), function () {
            throw failure;
        });
        await scope.assert.rejects(async function () {
            await task.wait();
        }, { message: failure.message });
        await settleRecords(state);
        scope.assert.deepEqual(validateInFlightTasks(state), []);
        return scope.assert.collect();
    }),
    test('reports a settled task which was never observed', async function (scope) {
        const state = createAsyncControlState();
        startInFlight(state, rejectionAssertions(scope.assert.rejects), async function () {
            return 42;
        });
        await settleRecords(state);
        scope.assert.partialDeepEqual<unknown, unknown>(validateInFlightTasks(state), [ {
            code: 'unobserved-in-flight-task',
            actual: 1
        } ]);
        scope.assert.deepEqual(state.inFlightRecords(), []);
        return scope.assert.collect();
    }),
    test('reports pending tasks and releases the retained ownership records', async function (scope) {
        const state = createAsyncControlState();
        const completion = Promise.withResolvers<number>();
        const task = startInFlight(state, rejectionAssertions(scope.assert.rejects), async function () {
            return completion.promise;
        });
        scope.assert.partialDeepEqual<unknown, unknown>(validateInFlightTasks(state), [ {
            code: 'pending-in-flight-task',
            actual: 1
        } ]);
        completion.resolve(42);
        scope.assert.equal(await task.wait(), 42);
        scope.assert.deepEqual(state.inFlightRecords(), []);
        return scope.assert.collect();
    })
]);
