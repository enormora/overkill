import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { PlacementPlan } from './run-types.ts';
import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import type {
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';
import { createStaticDispatcher } from './worker-pool-static-dispatcher.ts';
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool static dispatcher fixture requires a lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool static dispatcher fixture requires a work unit.');
    }

    return unit;
}

function workerLane(id: string): PlacementLane {
    const lane = firstLane(placementPlan());

    return {
        ...lane,
        executor: {
            ...lane.executor,
            id
        },
        id
    };
}

function twoLanePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');

    return {
        assignments: [ { lane: first.id, unit: unit.id } ],
        lanes: [ first, second ],
        units: [ unit ]
    };
}

function runtimeWithStaticDispatch(plan: PlacementPlan): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(plan);
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool static dispatcher fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    dispatchPolicy: 'static-assignment',
                    placementPlan: plan
                }
            }
        }
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool static dispatcher fixture expected a lease.');
    }

    return lease;
}

async function assertStaticRequeue(scope: OverkillScope): Promise<void> {
    const unit = firstUnit(placementPlan());
    const plan = twoLanePlan(unit);
    const dispatcher = createWorkDispatcher(runtimeWithStaticDispatch(plan), plan);
    const firstLease = pullRequiredLease(dispatcher, firstLane(plan));

    dispatcher.requeue({ traceUnit: firstLease.traceUnit, unit: firstLease.unit });
    scope.assert.equal(pullRequiredLease(dispatcher, firstLane(plan)).unit.id.key, unit.id.key);
    dispatcher.clear();
    scope.assert.equal(dispatcher.pull(firstLane(plan)), null);
    await dispatcher.waitForChange();
}

function assertStaticDispatcherRejectsUnknownUnits(scope: OverkillScope): void {
    const unit = firstUnit(placementPlan());
    const plan = twoLanePlan(unit);

    scope.assert.throws(function createUnknownStaticAssignment() {
        createStaticDispatcher({
            ...plan,
            assignments: [ {
                lane: firstLane(plan).id,
                unit: { ...unit.id, key: 'missing' }
            } ]
        });
    }, { message: 'Placement assignment referenced an unknown work unit.' });

    scope.assert.throws(function requeueUnassignedStaticUnit() {
        createStaticDispatcher({ ...plan, assignments: [] }).requeue({ traceUnit: unit.id, unit });
    }, { message: 'Static worker-pool dispatch cannot requeue an unassigned work unit.' });
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-static-dispatcher.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool static dispatcher requeues assigned units',
            async body(scope: OverkillScope) {
                await assertStaticRequeue(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool static dispatcher rejects unknown units',
            body(scope: OverkillScope) {
                assertStaticDispatcherRejectsUnknownUnits(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
