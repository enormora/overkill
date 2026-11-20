import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import {
    crashLimitMessage,
    testCaseMetadata,
    firstCaseId,
    firstCaseIdentityKey,
    createCollectedPlan,
    placementPlan,
    testOnlyDependency,
    createFakePool,
    fakeWorkerRuntime,
    createTaskRun
} from '../test-support/worker-pool-execution-state.ts';

import { createSupervisedRunState } from './supervised-run-state.ts';
import { executeWorkerPoolUnits } from './worker-pool-execution.ts';
import { reportRunStart, startPoolProcessUsageTracking } from './worker-pool-process-usage-tracking.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

function invalidOutputRuntime(recordRun: () => void): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const pool = createFakePool(1, false);
    pool.run = async function runInvalidWorkerTask() {
        recordRun();

        return { invalid: true };
    };

    return { ...runtime, pool };
}

function budgetedRuntime(taskRun: WorkerPoolTaskRun): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(createCollectedPlan());

    return {
        ...runtime,
        attachments: null,
        activeTasks: new Set([ taskRun ]),
        poolProcessUsageTracker: {
            finish: testOnlyDependency,
            start(recordSample) {
                recordSample?.({
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMicroseconds: 1,
                    javaScriptEngineHeapBytes: 1,
                    residentSetBytes: 20
                });
            }
        },
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...runtime.resolvedRun.facts.execution,
                    processUsagePolicy: {
                        budgets: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: 10,
                            residentSetGrowthBytesPerSecond: null
                        },
                        measure: true,
                        samplingIntervalMilliseconds: 5
                    }
                }
            }
        }
    };
}

type HedgedBudgetRun = {
    readonly activeTask: WorkerPoolTaskRun;
    readonly hedge: WorkerPoolTaskRun;
    readonly runtime: WorkerPoolRunRuntime;
};

function hedgedBudgetRuntime(): HedgedBudgetRun {
    const activeTask = createTaskRun(createSupervisedRunState('first-failure-and-final'));
    const hedge = createTaskRun(createSupervisedRunState('first-failure-and-final'));
    const runtime = { ...budgetedRuntime(activeTask), activeTasks: new Set([ activeTask, hedge ]) };
    hedge.state.addActiveCase(firstCaseIdentityKey(), { capture: null, id: firstCaseId() }, 0, {
        index: 1
    });

    activeTask.state.addActiveCase(firstCaseIdentityKey(), { capture: null, id: firstCaseId() }, 0, {
        index: 0
    });
    activeTask.timeout.write(runtime.dependencies.wallClock.setTimeout(
        activeTask.controller.abort.bind(activeTask.controller),
        100
    ));
    return { activeTask, hedge, runtime };
}

function assertSharedExhaustion(scope: TestScope, runtime: WorkerPoolRunRuntime): void {
    const artifacts = runtime.runState.artifacts();
    scope.assert.equal(artifacts.length, 1);
    const artifact = artifacts[0];
    scope.require.defined(artifact);
    scope.assert.equal(artifact.id.scope.kind, 'run');
    scope.assert.equal(artifact.id.attempt, null);
    if (artifact.payload.kind !== 'process-exhaustion') {
        throw new Error('Expected pool exhaustion evidence.');
    }
    scope.assert.deepEqual(
        artifact.payload.activeWork.map(function capturedAttempt(active) {
            return active.attempt.index;
        }),
        [ 0, 1 ]
    );
}

export const testNode: TestNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool execution state',
    children: [
        test({
            ...testCaseMetadata,
            title: 'stops after repeated invalid worker outputs',
            async body(scope) {
                let poolRuns = 0;
                const runtime = invalidOutputRuntime(function recordRun() {
                    poolRuns += 1;
                });
                const completed = await executeWorkerPoolUnits(runtime, placementPlan(), 0);

                scope.assert.equal(poolRuns, 3);
                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.equal(runtime.runState.runnerErrors()[0]?.message, crashLimitMessage);
                scope.assert.equal(completed.length, 3);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool process usage tracking stops active tasks on pool budget breach',
            async body(scope) {
                const { activeTask, hedge, runtime } = hedgedBudgetRuntime();
                await reportRunStart({ ...runtime, collectedPlan: { ...runtime.collectedPlan, files: [] } }, 0);
                await startPoolProcessUsageTracking(runtime);

                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.equal(activeTask.controller.signal.aborted, true);
                scope.assert.equal(activeTask.state.perTestResults()[0]?.verdict, 'process-exhausted');
                scope.assert.equal(hedge.controller.signal.aborted, true);
                assertSharedExhaustion(scope, runtime);

                return scope.assert.collect();
            }
        })
    ]
});
