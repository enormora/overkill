import { type TestScope, suite, test } from '@overkill-dev/test';

import { workerTaskRuntime } from '../test-support/worker-task-runtime.ts';

import type { WorkerPoolCollection } from './worker-pool-protocol.ts';
import { runWorkerPoolTask } from './worker-pool-worker.ts';

function isCollectionOutput(value: unknown): value is WorkerPoolCollection {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'collectedPlan');
}
export const testNode = suite('worker task dispatch and ownership', [
    test('collects and closes the task channel after publishing timing', async function (scope) {
        const fixture = workerTaskRuntime(null, null);
        const result = await runWorkerPoolTask({ ...fixture.task, kind: 'collect' }, fixture.runtime);
        scope.assert.equal(isCollectionOutput(result) ? result.collectedPlan.defined : null, 1);
        scope.assert.deepEqual<unknown, unknown>(isCollectionOutput(result) ? result.runnerErrors : null, []);
        scope.assert.deepEqual(Array.from(fixture.events), [ 'capture', 'collect', 'restore-capture', 'close' ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.messages.at(-1), { kind: 'task-messages-completed' });
        return scope.assert.collect();
    }),
    test(
        'restores collection output and closes the channel after collection failure',
        async function (scope) {
            const error = new Error('collection failed');
            const fixture = workerTaskRuntime(error, null);
            await scope.assert.rejects(async function () {
                return await runWorkerPoolTask({ ...fixture.task, kind: 'collect' }, fixture.runtime);
            }, { exact: error });
            scope.assert.deepEqual(Array.from(fixture.events), [ 'capture', 'collect', 'restore-capture', 'close' ]);
            scope.assert.partialDeepEqual<unknown, unknown>(fixture.messages.at(-2), {
                kind: 'timing',
                span: { kind: 'worker.teardown' }
            });
            return scope.assert.collect();
        }
    ),
    test('returns an empty assignment without capturing execution output', async function (scope) {
        const fixture = workerTaskRuntime(null, null);
        const result = await runWorkerPoolTask({ ...fixture.task, assignedUnits: [] }, fixture.runtime);
        scope.assert.deepEqual<unknown, unknown>(result, { results: [] });
        scope.assert.deepEqual(Array.from(fixture.events), [ 'suppress', 'collect', 'restore-suppression', 'close' ]);
        return scope.assert.collect();
    }),
    test('runs assigned work and reports attempt boundaries', async function (scope) {
        const fixture = workerTaskRuntime(null, null);
        const result = await runWorkerPoolTask(fixture.task, fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(result, {
            results: [ { result: { status: 'passed' }, traceUnit: fixture.task.assignedUnits[0]?.traceUnit } ]
        });
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.executions[0]?.[1], {
            seed: 0n,
            processBudgets: { residentSetBytes: null },
            startedAt: '1970-01-01T00:00:00.000Z'
        });
        scope.assert.deepEqual(Array.from(fixture.events), [
            'suppress',
            'collect',
            'restore-suppression',
            'capture',
            'prepare-execution',
            'restore-capture',
            'close'
        ]);
        scope.assert.partialDeepEqual<unknown, unknown>(
            fixture.messages.find(function (message) {
                return message.kind === 'attempt-completed';
            }),
            { attempt: 'attempt-1', durationMicroseconds: 1000 }
        );
        await runWorkerPoolTask({ ...fixture.task, kind: 'dispose-lane-lifecycle' }, fixture.runtime);
        return scope.assert.collect();
    }),
    test('restores output and closes the channel after execution failure', async function (scope) {
        const error = new Error('execution failed');
        const fixture = workerTaskRuntime(null, error);
        await scope.assert.rejects(async function () {
            return await runWorkerPoolTask(fixture.task, fixture.runtime);
        }, { exact: error });
        scope.assert.equal(fixture.events.at(-2), 'restore-capture');
        scope.assert.equal(fixture.events.at(-1), 'close');
        scope.assert.equal(
            fixture.messages.some(function (message) {
                return message.kind === 'attempt-completed';
            }),
            false
        );
        await runWorkerPoolTask({ ...fixture.task, kind: 'dispose-lane-lifecycle' }, fixture.runtime);
        return scope.assert.collect();
    }),
    test('restores bootstrap output after assignment collection failure', async function (scope) {
        const error = new Error('collection failed');
        const fixture = workerTaskRuntime(error, null);
        await scope.assert.rejects(async function () {
            return await runWorkerPoolTask(fixture.task, fixture.runtime);
        }, { exact: error });
        scope.assert.deepEqual(Array.from(fixture.events), [ 'suppress', 'collect', 'restore-suppression', 'close' ]);
        return scope.assert.collect();
    }),
    test('acquires, completes and disposes the resource owner', async function (scope) {
        const fixture = workerTaskRuntime(null, null);
        const result = await runWorkerPoolTask(
            { ...fixture.task, kind: 'acquire-run-resources', boundaryKeys: [] },
            fixture.runtime
        );
        const completed = await runWorkerPoolTask({
            ...fixture.task,
            kind: 'complete-resource-owner-work',
            boundaryKeys: []
        }, fixture.runtime);
        const disposed = await runWorkerPoolTask({ ...fixture.task, kind: 'dispose-run-resources' }, fixture.runtime);
        scope.assert.deepEqual<unknown, unknown>(result, { projectedResources: { resources: [] }, runnerErrors: [] });
        scope.assert.deepEqual<unknown, unknown>(completed, { runnerErrors: [] });
        scope.assert.deepEqual<unknown, unknown>(disposed, { runnerErrors: [] });
        return scope.assert.collect();
    }),
    test('returns no preparation failures when a resource owner is absent', async function (scope: TestScope) {
        const fixture = workerTaskRuntime(null, null);
        const work = fixture.task.runWork[0];
        scope.require.defined(work);
        const result = await runWorkerPoolTask({
            ...fixture.task,
            kind: 'prepare-resource-artifacts',
            work,
            attempt: { index: 0 },
            attachmentEndpoint: null
        }, fixture.runtime);
        scope.assert.deepEqual<unknown, unknown>(result, { runnerErrors: [] });
        return scope.assert.collect();
    })
]);
