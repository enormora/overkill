import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from '../test-support/worker-pool-placement-validation-fixture.ts';
import type { PlacementPlan } from './run-types.ts';
import type { WorkerPoolUnitLease, WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';
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
        resourceOwnership: { owners: [] },
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

const assertStaticRequeue = defineCompositeAssertion({
    name: 'static requeue',
    async assert(check) {
        const unit = firstUnit(placementPlan());
        const plan = twoLanePlan(unit);
        const dispatcher = createWorkDispatcher(runtimeWithStaticDispatch(plan), plan);
        const firstLease = pullRequiredLease(dispatcher, firstLane(plan));
        dispatcher.requeue({
            previousAttempt: firstLease.members[0].attempt,
            traceUnit: firstLease.traceUnit,
            unit: firstLease.unit
        });
        const initialChecks = check.equal(pullRequiredLease(dispatcher, firstLane(plan)).unit.id.key, unit.id.key);
        dispatcher.clear();
        const intermediateChecks = check.equal(dispatcher.pull(firstLane(plan)), null);
        await dispatcher.waitForChange();
        return check.group([ initialChecks, intermediateChecks ]);
    }
});

const assertStaticDispatcherRejectsUnknownUnits = defineCompositeAssertion({
    name: 'static dispatcher rejects unknown units',
    assert(check) {
        const unit = firstUnit(placementPlan());
        const plan = twoLanePlan(unit);
        return check.group([
            check.throws(function createUnknownStaticAssignment() {
                createStaticDispatcher({
                    ...plan,
                    assignments: [ {
                        lane: firstLane(plan).id,
                        unit: { ...unit.id, key: 'missing' }
                    } ]
                });
            }, { message: 'Placement assignment referenced an unknown work unit.' }),
            check.throws(function requeueUnassignedStaticUnit() {
                createStaticDispatcher({ ...plan, assignments: [] }).requeue({
                    previousAttempt: 'attempt-1',
                    traceUnit: unit.id,
                    unit
                });
            }, { message: 'Static worker-pool dispatch cannot requeue an unassigned work unit.' })
        ]);
    }
});

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool static dispatcher',
    children: [
        test({
            ...testCaseMetadata,
            title: 'requeues assigned units',
            async body(scope) {
                await scope.assert(assertStaticRequeue);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'rejects unknown units',
            body(scope) {
                scope.assert(assertStaticDispatcherRejectsUnknownUnits);

                return scope.assert.collect();
            }
        })
    ]
});
