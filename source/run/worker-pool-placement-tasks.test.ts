import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { executeWorkerPoolUnits } from './worker-pool-execution.ts';
import {
    createAcceptingPool,
    fakeWorkerRuntime,
    integrationPath,
    placementPlan,
    placementPlanWithGroupUnit,
    placementPlanWithUnitPolicy,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-placement-tasks.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution accepts group units',
            async body(scope: OverkillScope) {
                const acceptingPool = createAcceptingPool();
                const runtime = {
                    ...fakeWorkerRuntime(placementPlan()),
                    pool: acceptingPool.pool
                };
                const completed = await executeWorkerPoolUnits(
                    runtime,
                    placementPlanWithGroupUnit(),
                    0
                );
                const capturedTask = acceptingPool.capturedTasks[0];

                scope.assert.equal(completed.length, 1);
                scope.require.defined(capturedTask);
                scope.assert.deepEqual(capturedTask.command.paths, [ integrationPath ]);
                scope.assert.equal(capturedTask.assignedWork.length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution applies unit scheduling and lifecycle',
            async body(scope: OverkillScope) {
                const acceptingPool = createAcceptingPool();
                const runtime = {
                    ...fakeWorkerRuntime(placementPlan()),
                    pool: acceptingPool.pool
                };

                await executeWorkerPoolUnits(runtime, placementPlanWithUnitPolicy(), 0);
                const capturedTask = acceptingPool.capturedTasks[0];

                scope.require.defined(capturedTask);
                scope.assert.equal(capturedTask.command.scheduling, 'concurrent');
                scope.assert.equal(capturedTask.command.workerLifecycle, 'fresh-worker-per-unit');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
