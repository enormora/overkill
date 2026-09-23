import { setTimeout as sleep } from 'node:timers/promises';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { PlacementPlan } from './run-types.ts';
import { executeWorkerPoolUnits } from './worker-pool-execution.ts';
import {
    type AcceptingPool,
    type CapturedWorkerTask,
    completedWorkerPoolOutput,
    createAcceptingPool,
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

type PlacementAssignment = PlacementPlan['assignments'][number];
type WorkUnit = PlacementPlan['units'][number];
type ControlledPool = AcceptingPool & {
    readonly finishNext: () => void;
    readonly pendingCount: () => number;
};
type ControlledExecution = {
    readonly completed: Promise<readonly WorkerPoolTaskRun[]>;
    readonly controlledPool: ControlledPool;
};
type BatchStartedTraceEntry = Extract<WorkerPoolRunRuntime['placementTraceEntries'][number], {
    readonly kind: 'batch-started';
}>;

function firstUnit(): WorkUnit {
    const unit = placementPlan().units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool pending split fixture requires a work unit.');
    }

    return unit;
}

function workerLane(id: string): PlacementPlan['lanes'][number] {
    const lane = placementPlan().lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool pending split fixture requires a lane.');
    }

    return {
        ...lane,
        executor: {
            ...lane.executor,
            id
        },
        id
    };
}

function defaultResourceConstraints(): WorkUnit['resourceConstraints'] {
    return {
        affinityKeys: [],
        capacityWeight: 1,
        duplicateExecution: [],
        faultDomains: [],
        serialKeys: [],
        singleWorkerKeys: []
    };
}

function workUnit(key: string): WorkUnit {
    const unit = firstUnit();
    const work = unit.work[0];

    return {
        ...unit,
        id: {
            ...unit.id,
            key
        },
        resourceConstraints: defaultResourceConstraints(),
        work: [
            {
                ...work,
                case: {
                    ...work.case,
                    title: key
                }
            }
        ]
    };
}

function multiWorkUnit(key: string): WorkUnit {
    const unit = workUnit(key);
    const work = unit.work[0];

    return {
        ...unit,
        scheduling: 'concurrent',
        work: [
            work,
            {
                ...work,
                case: {
                    ...work.case,
                    title: `${key}-extra`
                }
            }
        ]
    };
}

function twoLanePlacement(assignments: readonly PlacementAssignment[], units: readonly WorkUnit[]): PlacementPlan {
    return {
        assignments,
        lanes: [ workerLane('worker-1'), workerLane('worker-2') ],
        units
    };
}

function splitCandidatePlacement(unit: WorkUnit): PlacementPlan {
    const filler = workUnit('split-filler');

    return twoLanePlacement([
        { lane: 'worker-1', unit: unit.id },
        { lane: 'worker-2', unit: filler.id }
    ], [ unit, filler ]);
}

function batchingPlacement(): PlacementPlan {
    const first = workUnit('first-batched');
    const second = workUnit('second-batched');
    const lane = workerLane('worker-1');

    return {
        assignments: [
            { lane: lane.id, unit: first.id },
            { lane: lane.id, unit: second.id }
        ],
        lanes: [ lane ],
        units: [ first, second ]
    };
}

async function letWorkerLoopsRun(): Promise<void> {
    await Promise.resolve();
    await sleep(0);
}

function finishPendingTask(pool: ControlledPool): void {
    if (pool.pendingCount() > 0) {
        pool.finishNext();
    }
}

function createControlledPool(): ControlledPool {
    const capturedTasks: CapturedWorkerTask[] = [];
    let pendingTasks: readonly (() => void)[] = [];

    return {
        capturedTasks,
        finishNext() {
            const [ finish, ...remainingTasks ] = pendingTasks;

            pendingTasks = remainingTasks;

            if (finish === undefined) {
                throw new Error('Controlled worker pool has no pending task.');
            }

            finish();
        },
        pendingCount() {
            return pendingTasks.length;
        },
        pool: {
            async destroy() {
                return undefined;
            },
            options: { isolateWorkers: false, maxThreads: 1 },
            async run(task) {
                capturedTasks.push(task as CapturedWorkerTask);
                await new Promise<void>(function waitForFinish(resolve) {
                    pendingTasks = [ ...pendingTasks, resolve ];
                });

                return completedWorkerPoolOutput();
            }
        }
    };
}

function startControlledExecution(placement: PlacementPlan): ControlledExecution {
    const controlledPool = createControlledPool();
    const runtime = {
        ...fakeWorkerRuntime(placement),
        pool: controlledPool.pool
    };

    return {
        completed: executeWorkerPoolUnits(runtime, placement, 0),
        controlledPool
    };
}

function capturedTask(pool: AcceptingPool, index: number): CapturedWorkerTask {
    const task = pool.capturedTasks[index];

    if (task === undefined) {
        throw new Error('Expected a captured worker task.');
    }

    return task;
}

function assertSingleWorkTask(scope: OverkillScope, task: CapturedWorkerTask, title: string): void {
    const work = task.assignedWork[0];

    scope.assert.equal(task.assignedWork.length, 1);
    scope.assert.equal(work.case.title, title);
}

function assertSplitTasks(scope: OverkillScope, pool: ControlledPool): void {
    scope.assert.equal(pool.capturedTasks.length, 2);
    assertSingleWorkTask(scope, capturedTask(pool, 0), 'split-parent');
    assertSingleWorkTask(scope, capturedTask(pool, 1), 'split-parent-extra');
}

function batchStartedTraceEntry(
    entry: WorkerPoolRunRuntime['placementTraceEntries'][number] | undefined
): BatchStartedTraceEntry {
    if (entry?.kind === 'batch-started') {
        return entry;
    }

    throw new Error('Expected a batch-started trace entry.');
}

function assertBatchTraceStarted(
    scope: OverkillScope,
    placement: PlacementPlan,
    runtime: WorkerPoolRunRuntime
): void {
    scope.assert.deepEqual(batchStartedTraceEntry(runtime.placementTraceEntries[0]), {
        envelopeId: 'batch-1',
        kind: 'batch-started',
        lane: 'worker-1',
        units: placement.units.map(function toUnitId(unit) {
            return unit.id;
        }),
        workerId: 'worker-1'
    });
}

async function completeSplitExecution(execution: ControlledExecution): Promise<readonly WorkerPoolTaskRun[]> {
    finishPendingTask(execution.controlledPool);
    finishPendingTask(execution.controlledPool);
    await letWorkerLoopsRun();
    finishPendingTask(execution.controlledPool);

    return await execution.completed;
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-pending-splitting.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch runs split children as separate worker tasks',
            async body(scope: OverkillScope) {
                const unit = multiWorkUnit('split-parent');
                const execution = startControlledExecution(splitCandidatePlacement(unit));

                await letWorkerLoopsRun();
                assertSplitTasks(scope, execution.controlledPool);
                const completedRuns = await completeSplitExecution(execution);

                scope.assert.equal(completedRuns.length, 3);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch executes compatible batches as one task',
            async body(scope: OverkillScope) {
                const placement = batchingPlacement();
                const acceptingPool = createAcceptingPool();
                const runtime = {
                    ...fakeWorkerRuntime(placement),
                    pool: acceptingPool.pool
                };

                const completed = await executeWorkerPoolUnits(runtime, placement, 0);

                scope.assert.equal(completed.length, 1);
                scope.assert.equal(acceptingPool.capturedTasks.length, 1);
                scope.assert.deepEqual(
                    capturedTask(acceptingPool, 0).assignedWork.map(function toTitle(work) {
                        return work.case.title;
                    }),
                    [ 'first-batched', 'second-batched' ]
                );
                scope.assert.deepEqual(
                    runtime.placementTraceEntries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'batch-started', 'batch-completed' ]
                );
                assertBatchTraceStarted(scope, placement, runtime);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
