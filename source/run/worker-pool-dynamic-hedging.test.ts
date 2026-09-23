import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { emptyWorkUnitResourceConstraints, type PlacementPlan } from './run-types.ts';
import {
    fakeWorkerRuntime,
    placementPlan,
    testCaseMetadata
} from './worker-pool-placement-validation.test.ts';
import type {
    WorkerPoolUnitLease,
    WorkerPoolWorkDispatcher
} from './worker-pool-dispatch-state.ts';
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];
type HedgedStragglerRun = {
    readonly dispatcher: WorkerPoolWorkDispatcher;
    readonly duplicate: WorkerPoolUnitLease;
    readonly filler: WorkerPoolUnitLease;
    readonly plan: PlacementPlan;
    readonly primary: WorkerPoolUnitLease;
    readonly runtime: WorkerPoolRunRuntime;
};

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool dynamic hedging fixture requires a lane.');
    }

    return lane;
}

function secondLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[1];

    if (lane === undefined) {
        throw new Error('Worker-pool dynamic hedging fixture requires a second lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool dynamic hedging fixture requires a work unit.');
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

function firstWork(unit: WorkUnit): WorkUnit['work'][number] {
    return unit.work[0];
}

function splitCandidatePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');
    const filler: WorkUnit = {
        ...firstUnit(placementPlan()),
        id: {
            ...unit.id,
            key: 'filler'
        },
        scheduling: 'concurrent',
        work: [ {
            ...firstWork(unit),
            case: {
                ...firstWork(unit).case,
                title: 'filler'
            }
        } ]
    };

    return {
        assignments: [
            { lane: first.id, unit: unit.id },
            { lane: second.id, unit: filler.id }
        ],
        lanes: [ first, second ],
        units: [ unit, filler ]
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

function weightedUnit(key: string, capacityWeight: number): WorkUnit {
    const unit = firstUnit(placementPlan());

    return {
        ...unit,
        id: {
            ...unit.id,
            key
        },
        resourceConstraints: {
            ...unit.resourceConstraints,
            capacityWeight
        }
    };
}

function weightedPlan(): PlacementPlan {
    const heavy = weightedUnit('heavy', 2);
    const light = weightedUnit('light', 1);
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');

    return {
        assignments: [
            { lane: first.id, unit: light.id },
            { lane: second.id, unit: heavy.id }
        ],
        lanes: [ first, second ],
        units: [ light, heavy ]
    };
}

function runtimeWithEmptyDurationHistory(plan: PlacementPlan): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(plan);
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool dynamic hedging fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [],
                    source: 'runtime-state-index'
                },
                execution: {
                    ...execution,
                    assignmentPolicy: 'duration-history-balanced',
                    placementPlan: plan
                }
            }
        }
    };
}

function runtimeWithHedging(plan: PlacementPlan): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(plan);
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool dynamic hedging fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    hedging: {
                        durationMultiplier: 1,
                        minimumDelayMilliseconds: 0,
                        mode: 'on'
                    },
                    placementPlan: plan
                }
            }
        }
    };
}

function hedgeSafeUnit(): WorkUnit {
    const unit = firstUnit(placementPlan());

    return {
        ...unit,
        resourceConstraints: {
            ...unit.resourceConstraints,
            duplicateExecution: [ 'idempotent' ]
        },
        scheduling: 'concurrent',
        work: [ firstWork(unit) ]
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool dynamic hedging fixture expected a lease.');
    }

    return lease;
}

function runHedgedStraggler(): HedgedStragglerRun {
    const plan = splitCandidatePlan(hedgeSafeUnit());
    const runtime = runtimeWithHedging(plan);
    const dispatcher = createWorkDispatcher(runtime, plan);
    const primary = pullRequiredLease(dispatcher, firstLane(plan));
    const filler = pullRequiredLease(dispatcher, secondLane(plan));

    dispatcher.finish(filler, false);
    const duplicate = pullRequiredLease(dispatcher, secondLane(plan));

    return { dispatcher, duplicate, filler, plan, primary, runtime };
}

function assertHedgedStraggler(scope: OverkillScope): void {
    const { dispatcher, duplicate, filler, plan, primary, runtime } = runHedgedStraggler();

    scope.assert.equal(primary.kind, 'primary');
    scope.assert.equal(filler.kind, 'primary');
    scope.assert.equal(duplicate.kind, 'hedged-duplicate');
    scope.assert.deepEqual(duplicate.unit.work, primary.unit.work);
    const traceEntry = runtime.placementTraceEntries[0];

    scope.require.defined(traceEntry);
    scope.assert.deepEqual(traceEntry, {
        kind: 'hedged-duplicate-started',
        unit: primary.traceUnit,
        workerId: secondLane(plan).id
    });
    dispatcher.finish(duplicate, false);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-dynamic-hedging.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher hedges explicit idempotent stragglers',
            body(scope: OverkillScope) {
                assertHedgedStraggler(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher does not hedge unsafe stragglers',
            body(scope: OverkillScope) {
                const unit = { ...hedgeSafeUnit(), resourceConstraints: emptyWorkUnitResourceConstraints };
                const plan = twoLanePlan(unit);
                const dispatcher = createWorkDispatcher(runtimeWithHedging(plan), plan);

                pullRequiredLease(dispatcher, firstLane(plan));
                scope.assert.equal(dispatcher.pull(secondLane(plan)), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher falls back when duration history is empty',
            body(scope: OverkillScope) {
                const plan = weightedPlan();
                const runtime = runtimeWithEmptyDurationHistory(plan);
                const lease = pullRequiredLease(createWorkDispatcher(runtime, plan), firstLane(plan));

                scope.assert.equal(lease.unit.id.key, 'heavy');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
