import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { mutationRunnerRuntime } from '../../test-support/mutation-runner-runtime.ts';

const success = { status: 'complete' };
const timeout = { status: 'timeout' };
export const testNode = suite('Stryker runner lifecycle ownership', [
    test('initializes lazily once and shares the ready runner', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        scope.assert.deepEqual(Array.from(fixture.calls), []);
        scope.assert.equal(await fixture.lifecycle.ready(null), fixture.runner);
        scope.assert.equal(await fixture.lifecycle.ready(null), fixture.runner);
        scope.assert.deepEqual(Array.from(fixture.calls), [ 'initialize' ]);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('releases the campaign and execution exactly once', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        await fixture.lifecycle.ready(null);
        await fixture.lifecycle.dispose();
        await fixture.lifecycle.dispose();
        scope.assert.deepEqual(Array.from(fixture.calls), [
            'initialize',
            'release',
            'execution.dispose',
            'client.dispose'
        ]);
        scope.assert.true(fixture.inputs[0]?.signal.aborted);
        return scope.assert.collect();
    }),
    test('disposes an unused runner without initialization', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        await fixture.lifecycle.dispose();
        scope.assert.deepEqual(Array.from(fixture.calls), []);
        let failure: unknown = null;
        try {
            await fixture.lifecycle.ready(null);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Stryker runner has been disposed.');
        return scope.assert.collect();
    }),
    test('does not initialize for invalid deadlines', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        for (const deadline of [ 0, -1, Number.NaN, Number.POSITIVE_INFINITY ]) {
            scope.assert.equal(
                await fixture.lifecycle.invoke(deadline, async function () {
                    throw new Error('Must not run.');
                }, function () {
                    return timeout;
                }),
                timeout
            );
        }
        scope.assert.deepEqual(Array.from(fixture.calls), []);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('passes the initialized runner and deadline to an invocation', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        const result = await fixture.lifecycle.invoke(50, async function (runner, budget) {
            scope.assert.equal(runner, fixture.runner);
            scope.assert.equal(budget.remainingMilliseconds(), 50);
            scope.assert.equal(fixture.inputs[0]?.budget(), budget);
            return success;
        }, function () {
            return timeout;
        });
        scope.assert.equal(result, success);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('converts a late successful result to timeout', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        const completed: unknown[] = [];
        const result = await fixture.lifecycle.invoke(50, async function () {
            fixture.clock.advanceByMilliseconds(50);
            return success;
        }, function (value) {
            completed.push(value);
            return timeout;
        });
        scope.assert.equal(result, timeout);
        scope.assert.deepEqual(completed, [ success ]);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('preserves error results after a deadline', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        const failure = { status: 'error' };
        const result = await fixture.lifecycle.invoke(50, async function () {
            fixture.clock.advanceByMilliseconds(50);
            return failure;
        }, function () {
            return timeout;
        });
        scope.assert.equal(result, failure);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('converts deadline cancellation into timeout', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        const result = await fixture.lifecycle.invoke(50, async function (_runner, budget) {
            fixture.clock.advanceByMilliseconds(50);
            budget.signal.throwIfAborted();
            return success;
        }, function () {
            return timeout;
        });
        scope.assert.equal(result, timeout);
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test('preserves ordinary invocation failures', async function (scope: TestScope) {
        const fixture = mutationRunnerRuntime();
        const failure = new Error('Invocation failed.');
        let caught: unknown = null;
        try {
            await fixture.lifecycle.invoke(50, async function () {
                throw failure;
            }, function () {
                return timeout;
            });
        } catch (error: unknown) {
            caught = error;
        }
        scope.assert.equal(caught, failure);
        scope.assert.equal(
            await fixture.lifecycle.invoke(50, async function () {
                return success;
            }, function () {
                return timeout;
            }),
            success
        );
        await fixture.lifecycle.dispose();
        return scope.assert.collect();
    }),
    test(
        'rejects overlapping invocations and permits the next one after completion',
        async function (scope: TestScope) {
            const fixture = mutationRunnerRuntime();
            const completion = Promise.withResolvers<typeof success>();
            const active = fixture.lifecycle.invoke(50, async function () {
                return await completion.promise;
            }, function () {
                return timeout;
            });
            await scope.assert.rejects(async function () {
                await fixture.lifecycle.invoke(50, async function () {
                    return success;
                }, function () {
                    return timeout;
                });
            }, { type: Error, message: 'A Stryker invocation is already running.' });
            completion.resolve(success);
            scope.assert.equal(await active, success);
            await fixture.lifecycle.dispose();
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
