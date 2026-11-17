import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { workerPlacementExecution } from '../test-support/worker-placement-execution.ts';
import { testNode as output } from './worker-task-output-policy.test.ts';

export const testNode = suite('worker placement execution policy', [
    output,
    test('completes a placement after receiving the worker message boundary', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('none');
        const tasks = await fixture.run();
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.equal(tasks.length, 1);
        scope.assert.equal(fixture.runtime.activeTasks.size, 0);
        scope.assert.equal(
            fixture
                .runtime
                .taskResults
                .flatMap(function (result) {
                    return result.perTest;
                })[0]
                ?.verdict,
            'pass'
        );
        scope.assert.deepEqual(fixture.runtime.runState.runnerErrors(), []);
        return scope.assert.collect();
    }),
    test('does not requeue work stopped deliberately by its parent', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('parent-stop');
        const tasks = await fixture.run();
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.equal(tasks.length, 1);
        scope.assert.true(tasks[0]?.endedByParent.read());
        scope.assert.false(tasks[0]?.requeuePendingCases.read());
        scope.assert.equal(fixture.runtime.activeTasks.size, 0);
        return scope.assert.collect();
    }),
    test('requeues parent-interrupted work until the crash limit is reached', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('parent-retry');
        const tasks = await fixture.run();
        scope.assert.equal(fixture.calls(), 3);
        scope.assert.equal(tasks.length, 3);
        scope.assert.true(fixture.runtime.terminalFailure.read());
        scope.assert.true(
            fixture.runtime.runState.runnerErrors().some(function (error) {
                return error.message === 'Worker-pool stopped after 3 worker crashes.';
            })
        );
        scope.assert.equal(fixture.runtime.activeTasks.size, 0);
        return scope.assert.collect();
    }),
    test('stops runtime-policy failures without retrying forbidden operations', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('permission');
        const tasks = await fixture.run();
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.true(fixture.runtime.terminalFailure.read());
        scope.assert.partialDeepEqual<unknown, unknown>(tasks[0]?.state.runnerErrors(), [ { subtype: 'permission' } ]);
        scope.assert.equal(fixture.runtime.activeTasks.size, 0);
        return scope.assert.collect();
    }),
    test('prioritizes host errors over worker crash recovery', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('host');
        await fixture.run();
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.true(fixture.runtime.terminalFailure.read());
        scope.assert.partialDeepEqual(fixture.runtime.runState.runnerErrors(), [ {
            message: 'host transport failed',
            subtype: 'crash'
        } ]);
        scope.assert.equal(fixture.runtime.activeTasks.size, 0);
        return scope.assert.collect();
    }),
    test('rejects malformed worker output and bounds crash recovery', async function (scope: TestScope) {
        const fixture = workerPlacementExecution('invalid');
        const tasks = await fixture.run();
        scope.assert.equal(fixture.calls(), 3);
        scope.assert.equal(tasks.length, 3);
        scope.assert.true(
            tasks[0]?.state.runnerErrors().some(function (error) {
                return error.message.includes('invalid result');
            })
        );
        scope.assert.true(fixture.runtime.terminalFailure.read());
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
