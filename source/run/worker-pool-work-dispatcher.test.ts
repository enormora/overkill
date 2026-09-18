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
import {
    createWorkDispatcher,
    type WorkerPoolUnitLease,
    type WorkerPoolWorkDispatcher
} from './worker-pool-work-dispatcher.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a lane.');
    }

    return lane;
}

function secondLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[1];

    if (lane === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a second lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool dispatcher fixture requires a work unit.');
    }

    return unit;
}

function constrainedUnit(unit: WorkUnit): WorkUnit {
    return {
        ...unit,
        resourceConstraints: {
            ...unit.resourceConstraints,
            faultDomains: [ 'rack' ],
            singleWorkerKeys: [ 'database' ]
        }
    };
}

function retainedReservationPlan(): PlacementPlan {
    const basePlan = placementPlan();
    const lane = firstLane(basePlan);
    const unit = constrainedUnit(firstUnit(basePlan));
    const fallbackLane = {
        ...lane,
        executor: {
            ...lane.executor,
            id: 'worker-2'
        },
        id: 'worker-2'
    };

    return {
        assignments: [ { lane: lane.id, unit: unit.id } ],
        lanes: [ lane, fallbackLane ],
        units: [ unit ]
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool dispatcher fixture expected a lease.');
    }

    return lease;
}

function assertFreshReservation(scope: OverkillScope, lease: WorkerPoolUnitLease): void {
    scope.assert.deepEqual(lease.reservation.faultDomains, [ 'rack' ]);
    scope.assert.deepEqual(lease.reservation.hardKeys, [ 'database' ]);
}

function assertRetainedReservation(scope: OverkillScope, lease: WorkerPoolUnitLease): void {
    scope.assert.deepEqual(lease.reservation.faultDomains, []);
    scope.assert.deepEqual(lease.reservation.hardKeys, []);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-work-dispatcher.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher retains partial leases on their lane',
            body(scope: OverkillScope) {
                const plan = retainedReservationPlan();
                const dispatcher = createWorkDispatcher(fakeWorkerRuntime(plan), plan);
                const firstLease = pullRequiredLease(dispatcher, firstLane(plan));

                assertFreshReservation(scope, firstLease);
                dispatcher.finish(firstLease, true);
                dispatcher.requeue(firstLease.unit);
                scope.assert.equal(dispatcher.pull(secondLane(plan)), null);
                assertRetainedReservation(scope, pullRequiredLease(dispatcher, firstLane(plan)));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
