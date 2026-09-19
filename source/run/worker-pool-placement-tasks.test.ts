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
    integrationPath,
    placementPlan,
    placementPlanWithGroupUnit,
    placementPlanWithUnitPolicy,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import type { WorkerPoolRunRuntime, WorkerPoolTaskRun } from './worker-pool-runtime.ts';

type PlacementAssignment = PlacementPlan['assignments'][number];
type WorkerPoolExecutionFacts = Extract<WorkerPoolRunRuntime['resolvedRun']['facts']['execution'], {
    readonly processModel: 'worker-pool';
}>;
type WorkUnit = PlacementPlan['units'][number];
type AcceptingExecutionFixture = {
    readonly acceptingPool: AcceptingPool;
    readonly runtime: WorkerPoolRunRuntime;
};
type ControlledPool = AcceptingPool & {
    readonly finishNext: () => void;
    readonly pendingCount: () => number;
};
type ControlledExecution = {
    readonly completed: Promise<readonly WorkerPoolTaskRun[]>;
    readonly controlledPool: ControlledPool;
};
type CapturedTaskExpectation = {
    readonly index: number;
    readonly lane: string;
    readonly title: string;
};
type DurationHistoryPlacement = {
    readonly fast: WorkUnit;
    readonly placement: PlacementPlan;
    readonly slow: WorkUnit;
};

function firstUnit(): WorkUnit {
    const unit = placementPlan().units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool placement task fixture requires a work unit.');
    }

    return unit;
}

function workerLane(id: string): PlacementPlan['lanes'][number] {
    const lane = placementPlan().lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool placement task fixture requires a lane.');
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

function workUnit(key: string, resourceConstraints: WorkUnit['resourceConstraints']): WorkUnit {
    const unit = firstUnit();
    const work = unit.work[0];

    return {
        ...unit,
        id: {
            ...unit.id,
            key
        },
        resourceConstraints,
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

function twoLanePlacement(assignments: readonly PlacementAssignment[], units: readonly WorkUnit[]): PlacementPlan {
    return {
        assignments,
        lanes: [ workerLane('worker-1'), workerLane('worker-2') ],
        units
    };
}

function placementPlanAssignedToSecondLane(): PlacementPlan {
    const unit = firstUnit();

    return twoLanePlacement([ { lane: 'worker-2', unit: unit.id } ], [ unit ]);
}

async function letWorkerLoopsRun(): Promise<void> {
    await Promise.resolve();
    await sleep(0);
}

function runtimeWithDispatchPolicy(
    runtime: WorkerPoolRunRuntime,
    dispatchPolicy: WorkerPoolExecutionFacts['dispatchPolicy']
): WorkerPoolRunRuntime {
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool dispatch test requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    dispatchPolicy
                }
            }
        }
    };
}

function acceptingExecutionFixture(placement: PlacementPlan): AcceptingExecutionFixture {
    const acceptingPool = createAcceptingPool();

    return {
        acceptingPool,
        runtime: {
            ...fakeWorkerRuntime(placement),
            pool: acceptingPool.pool
        }
    };
}

function assertCapturedTask(
    scope: OverkillScope,
    acceptingPool: AcceptingPool,
    expectation: CapturedTaskExpectation
): void {
    scope.assert.equal(acceptingPool.capturedTasks[expectation.index]?.lane, expectation.lane);
    scope.assert.equal(acceptingPool.capturedTasks[expectation.index]?.assignedWork[0]?.case.title, expectation.title);
}

function weightedTwoLanePlacement(): PlacementPlan {
    const small = workUnit('small', defaultResourceConstraints());
    const large = workUnit('large', {
        ...defaultResourceConstraints(),
        capacityWeight: 2
    });

    return twoLanePlacement([
        { lane: 'worker-1', unit: small.id },
        { lane: 'worker-2', unit: large.id }
    ], [ small, large ]);
}

function faultDomainPlacement(): PlacementPlan {
    const small = workUnit('fault-free', defaultResourceConstraints());
    const faultDomain = workUnit('fault-domain', {
        ...defaultResourceConstraints(),
        capacityWeight: 2,
        faultDomains: [ 'database' ]
    });

    return twoLanePlacement([
        { lane: 'worker-1', unit: small.id },
        { lane: 'worker-2', unit: faultDomain.id }
    ], [ small, faultDomain ]);
}

function hardKeyPlacement(): PlacementPlan {
    const first = workUnit('first-hard-key', {
        ...defaultResourceConstraints(),
        singleWorkerKeys: [ 'database' ]
    });
    const second = workUnit('second-hard-key', {
        ...defaultResourceConstraints(),
        singleWorkerKeys: [ 'database' ]
    });

    return twoLanePlacement([
        { lane: 'worker-1', unit: first.id },
        { lane: 'worker-2', unit: second.id }
    ], [ first, second ]);
}

function durationHistoryPlacement(): DurationHistoryPlacement {
    const fast = workUnit('fast-history', defaultResourceConstraints());
    const slow = workUnit('slow-history', defaultResourceConstraints());
    const extraSlowWork = {
        ...slow.work[0],
        case: {
            ...slow.work[0].case,
            title: 'slow-history-extra'
        }
    };
    const slowWithFallback = {
        ...slow,
        work: [ slow.work[0], extraSlowWork ] as const
    };

    return {
        fast,
        placement: twoLanePlacement([
            { lane: 'worker-1', unit: fast.id },
            { lane: 'worker-2', unit: slowWithFallback.id }
        ], [ fast, slowWithFallback ]),
        slow: slowWithFallback
    };
}

function runtimeWithDurationHistory(
    placement: PlacementPlan,
    runtime: WorkerPoolRunRuntime,
    fastUnit: WorkUnit,
    slowUnit: WorkUnit
): WorkerPoolRunRuntime {
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Duration-history dispatch fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [
                        {
                            durationMilliseconds: 1,
                            observedAt: '2026-01-01T00:00:00.000Z',
                            observations: [],
                            sampleCount: 1,
                            work: fastUnit.work[0]
                        },
                        {
                            durationMilliseconds: 100,
                            observedAt: '2026-01-01T00:00:00.000Z',
                            observations: [],
                            sampleCount: 1,
                            work: slowUnit.work[0]
                        }
                    ],
                    source: 'runtime-state-index'
                },
                execution: {
                    ...execution,
                    assignmentPolicy: 'duration-history-balanced',
                    placementPlan: placement
                }
            }
        }
    };
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

function createRejectingPool(error: Error): AcceptingPool {
    const capturedTasks: CapturedWorkerTask[] = [];

    return {
        capturedTasks,
        pool: {
            async destroy() {
                return undefined;
            },
            options: { isolateWorkers: false, maxThreads: 1 },
            async run(task) {
                capturedTasks.push(task as CapturedWorkerTask);
                throw error;
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

async function assertOnlyFirstHardKeyLease(scope: OverkillScope, controlledPool: ControlledPool): Promise<void> {
    await letWorkerLoopsRun();
    scope.assert.equal(controlledPool.capturedTasks.length, 1);
    scope.assert.equal(controlledPool.capturedTasks[0]?.lane, 'worker-1');
}

async function assertRetainedHardKeyLease(scope: OverkillScope, controlledPool: ControlledPool): Promise<void> {
    await letWorkerLoopsRun();
    scope.assert.equal(controlledPool.capturedTasks.length, 2);
    scope.assert.equal(controlledPool.capturedTasks[1]?.lane, 'worker-1');
    scope.assert.equal(controlledPool.pendingCount(), 1);
}

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
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool static dispatch runs only units assigned to each lane',
            async body(scope: OverkillScope) {
                const placement = placementPlanAssignedToSecondLane();
                const { acceptingPool, runtime } = acceptingExecutionFixture(placement);
                const completed = await executeWorkerPoolUnits(
                    runtimeWithDispatchPolicy(runtime, 'static-assignment'),
                    placement,
                    0
                );

                scope.assert.equal(completed.length, 1);
                scope.assert.equal(acceptingPool.capturedTasks.length, 1);
                scope.assert.equal(acceptingPool.capturedTasks[0]?.lane, 'worker-2');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch leases compatible pending work to idle lanes',
            async body(scope: OverkillScope) {
                const placement = weightedTwoLanePlacement();
                const { acceptingPool, runtime } = acceptingExecutionFixture(placement);

                await executeWorkerPoolUnits(runtime, placement, 0);

                scope.assert.equal(acceptingPool.capturedTasks.length, 2);
                assertCapturedTask(scope, acceptingPool, { index: 0, lane: 'worker-1', title: 'large' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch preserves frozen fault-domain quotas',
            async body(scope: OverkillScope) {
                const placement = faultDomainPlacement();
                const { acceptingPool, runtime } = acceptingExecutionFixture(placement);

                await executeWorkerPoolUnits(runtime, placement, 0);

                scope.assert.equal(acceptingPool.capturedTasks.length, 2);
                assertCapturedTask(scope, acceptingPool, { index: 0, lane: 'worker-1', title: 'fault-free' });
                assertCapturedTask(scope, acceptingPool, { index: 1, lane: 'worker-2', title: 'fault-domain' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch prioritizes duration-history load',
            async body(scope: OverkillScope) {
                const { fast, placement, slow } = durationHistoryPlacement();
                const { acceptingPool, runtime } = acceptingExecutionFixture(placement);

                await executeWorkerPoolUnits(runtimeWithDurationHistory(placement, runtime, fast, slow), placement, 0);
                assertCapturedTask(scope, acceptingPool, { index: 0, lane: 'worker-1', title: 'slow-history' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch releases failed hard and fault reservations',
            async body(scope: OverkillScope) {
                const constrained = workUnit('release-reservation', {
                    ...defaultResourceConstraints(),
                    faultDomains: [ 'rack' ],
                    singleWorkerKeys: [ 'database' ]
                });
                const placement = twoLanePlacement([ { lane: 'worker-1', unit: constrained.id } ], [ constrained ]);
                const rejectingPool = createRejectingPool(new Error('worker died'));
                const runtime = { ...fakeWorkerRuntime(placement), pool: rejectingPool.pool };
                const completed = await executeWorkerPoolUnits(runtime, placement, 0);

                scope.assert.equal(completed.length, 3);
                scope.assert.equal(rejectingPool.capturedTasks.length, 3);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatch keeps hard-key leases on their lane',
            async body(scope: OverkillScope) {
                const execution = startControlledExecution(hardKeyPlacement());

                await assertOnlyFirstHardKeyLease(scope, execution.controlledPool);
                execution.controlledPool.finishNext();
                await assertRetainedHardKeyLease(scope, execution.controlledPool);
                finishPendingTask(execution.controlledPool);
                const completedRuns = await execution.completed;
                scope.assert.equal(completedRuns.length, 2);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
