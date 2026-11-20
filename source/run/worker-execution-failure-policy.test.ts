import { type TestNode, suite, test, testDouble } from '@overkill-dev/test';

import { runResultFactory } from '../test-support/run-result-factory.ts';

import {
    fakeWorkerRuntime,
    createCollectedPlan,
    placementPlan,
    crashLimitMessage
} from '../test-support/worker-pool-execution-state.ts';
import { createHostRunnerErrors } from './run-orchestrator-dependencies.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import { executeWorkerPoolUnits } from './worker-pool-execution.ts';
import { stopWorkerPoolTasks } from './worker-pool-task-events.ts';

type FailureMode = 'cancelled' | 'crash' | 'host' | 'permission' | 'stopped' | 'terminal';
type FailedPool = { readonly runtime: WorkerPoolRunRuntime; readonly calls: () => number; };
function taskFailure(mode: FailureMode): unknown {
    return mode === 'permission'
        ? Object.assign(new Error('denied'), {
            code: 'ERR_ACCESS_DENIED',
            permission: 'FileSystemRead',
            resource: '/project/input.txt'
        })
        : 42;
}
function failingPool(mode: FailureMode): FailedPool {
    const original = fakeWorkerRuntime(createCollectedPlan());
    let calls = 0;
    const hostErrors = createHostRunnerErrors();
    if (mode === 'host') {
        const errors = runResultFactory.build({ runnerErrors: [ { message: 'Host disappeared.' } ] }).runnerErrors;
        for (const error of errors) {
            hostErrors.push(error);
        }
    }
    const runtime: WorkerPoolRunRuntime = {
        ...original,
        pool: {
            ...original.pool,
            takeHostRunnerErrors: hostErrors.take,
            async run(): Promise<void> {
                calls += 1;
                if (mode === 'stopped') {
                    runtime.terminalFailure.write(true);
                } else if (mode === 'cancelled') {
                    stopWorkerPoolTasks(runtime, null, 'runtime-policy', 'Task cancelled.');
                }
                testDouble.throws<() => void>(taskFailure(mode))();
            }
        }
    };
    return {
        runtime,
        calls() {
            return calls;
        }
    };
}
export const testNode: TestNode = suite('worker execution failure policy', [
    test('retains host failure evidence ahead of a coincident worker rejection', async function (scope) {
        const fixture = failingPool('host');
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.equal(fixture.runtime.runState.runnerErrors()[0]?.message, 'Host disappeared.');
        scope.assert.equal(completed[0]?.interruptionCause.read(), 'host-failure');
        return scope.assert.collect();
    }),
    test('does not schedule work after a terminal collection failure', async function (scope) {
        const fixture = failingPool('terminal');
        fixture.runtime.terminalFailure.write(true);
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.deepEqual(completed, []);
        scope.assert.equal(fixture.calls(), 0);
        return scope.assert.collect();
    }),
    test('retains non-error worker failures while bounding retries', async function (scope) {
        const fixture = failingPool('crash');
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.equal(fixture.calls(), 3);
        scope.assert.equal(completed[0]?.state.runnerErrors()[0]?.message, '42');
        scope.assert.equal(fixture.runtime.runState.runnerErrors()[0]?.message, crashLimitMessage);
        return scope.assert.collect();
    }),
    test('stops immediately when a worker reports denied permissions', async function (scope) {
        const fixture = failingPool('permission');
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.equal(completed[0]?.state.runnerErrors()[0]?.subtype, 'permission');
        scope.assert.true(fixture.runtime.terminalFailure.read());
        return scope.assert.collect();
    }),
    test('does not turn failures after terminal shutdown into new crashes', async function (scope) {
        const fixture = failingPool('stopped');
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.deepEqual<unknown, unknown>(completed[0]?.state.runnerErrors(), []);
        scope.assert.deepEqual(fixture.runtime.runState.runnerErrors(), []);
        return scope.assert.collect();
    }),
    test('does not requeue work cancelled by its parent', async function (scope) {
        const fixture = failingPool('cancelled');
        const completed = await executeWorkerPoolUnits(fixture.runtime, placementPlan(), 0);
        scope.assert.equal(fixture.calls(), 1);
        scope.assert.true(completed[0]?.endedByParent.read() === true);
        scope.assert.equal(completed[0]?.state.runnerErrors()[0]?.message, 'Task cancelled.');
        return scope.assert.collect();
    })
]);
