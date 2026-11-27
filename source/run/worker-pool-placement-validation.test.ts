import { suite, test } from '@overkill-dev/test';
import {
    testCaseMetadata,
    firstWorkUnit,
    placementPlan,
    fakeWorkerRuntime,
    type PlacementPlan
} from '../test-support/worker-pool-placement-validation-fixture.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { executeWorkerPoolUnits } from './worker-pool-execution.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

function placementPlanWithMissingUnit(): PlacementPlan {
    return {
        ...placementPlan(),
        assignments: [
            {
                lane: 'worker-1',
                unit: { familyVariant: null, key: 'missing', mode: 'file', runtimes: [], workload: null }
            }
        ]
    };
}

function placementPlanWithMissingLane(): PlacementPlan {
    const unit = firstWorkUnit();

    return {
        ...placementPlan(),
        assignments: [ { lane: 'missing-worker', unit: unit.id } ],
        units: [ unit ]
    };
}

function placementPlanWithMixedLaneLifecycles(): PlacementPlan {
    const reuse = firstWorkUnit();
    const fresh = {
        ...firstWorkUnit(),
        id: {
            ...firstWorkUnit().id,
            key: 'fresh'
        },
        workerLifecycle: 'fresh-worker-per-unit' as const
    };

    return {
        ...placementPlan(),
        assignments: [
            { lane: 'worker-1', unit: reuse.id },
            { lane: 'worker-1', unit: fresh.id }
        ],
        units: [ reuse, fresh ]
    };
}

function runtimeWithInstanceEngine(): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(placementPlan());

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            engine: { engine: defaultRunEngine, kind: 'instance' }
        }
    };
}

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool placement validation',
    children: [
        test({
            ...testCaseMetadata,
            title: 'rejects placement assignments for missing units',
            async body(scope) {
                await scope.assert.rejects(async function executeMissingUnit() {
                    await executeWorkerPoolUnits(fakeWorkerRuntime(placementPlan()), placementPlanWithMissingUnit(), 0);
                }, { message: 'Placement assignment referenced an unknown work unit.' });
                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'rejects placement assignments for missing lanes',
            async body(scope) {
                await scope.assert.rejects(async function executeMissingLane() {
                    await executeWorkerPoolUnits(fakeWorkerRuntime(placementPlan()), placementPlanWithMissingLane(), 0);
                }, { message: 'Placement assignment referenced an unknown lane.' });
                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'rejects mixed lifecycle placement lanes',
            async body(scope) {
                await scope.assert.rejects(async function executeMixedLifecycleLane() {
                    await executeWorkerPoolUnits(
                        fakeWorkerRuntime(placementPlan()),
                        placementPlanWithMixedLaneLifecycles(),
                        0
                    );
                }, { message: 'Placement lane cannot mix worker lifecycle policies.' });
                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'reports instance engines as crashes',
            async body(scope) {
                const completed = await executeWorkerPoolUnits(runtimeWithInstanceEngine(), placementPlan(), 0);
                scope.assert.equal(
                    completed[0]?.state.runnerErrors()[0]?.message,
                    'Instance engines are not supported with worker-pool execution. Use a module engine.'
                );
                return scope.assert.collect();
            }
        })
    ]
});
