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
import {
    hedgeWakeDelay,
    laneHasPotentialHedge,
    selectHedgeCandidate,
    unitHedgeWorkKey,
    type HedgeActiveUnitLease,
    type HedgeDispatchState
} from './worker-pool-hedge-dispatch.ts';
import { createWorkDispatcher } from './worker-pool-work-dispatcher.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type WorkUnit = PlacementPlan['units'][number];
type PlacementLane = PlacementPlan['lanes'][number];
type DurationHistorySample = NonNullable<
    WorkerPoolRunRuntime['resolvedRun']['facts']['durationHistory']
>['samples'][number];

function firstLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool hedge dispatch fixture requires a lane.');
    }

    return lane;
}

function secondLane(plan: PlacementPlan): PlacementLane {
    const lane = plan.lanes[1];

    if (lane === undefined) {
        throw new Error('Worker-pool hedge dispatch fixture requires a second lane.');
    }

    return lane;
}

function firstUnit(plan: PlacementPlan): WorkUnit {
    const unit = plan.units[0];

    if (unit === undefined) {
        throw new Error('Worker-pool hedge dispatch fixture requires a work unit.');
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

function twoLanePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');

    return {
        assignments: [ { lane: first.id, unit: unit.id } ],
        lanes: [ first, second ],
        units: [ unit ]
    };
}

function fillerUnit(unit: WorkUnit): WorkUnit {
    return {
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
}

function splitCandidatePlan(unit: WorkUnit): PlacementPlan {
    const first = workerLane('worker-1');
    const second = workerLane('worker-2');
    const filler = fillerUnit(unit);

    return {
        assignments: [
            { lane: first.id, unit: unit.id },
            { lane: second.id, unit: filler.id }
        ],
        lanes: [ first, second ],
        units: [ unit, filler ]
    };
}

function durationSample(work: WorkUnit['work'][number], durationMicroseconds: number): DurationHistorySample {
    return {
        durationMicroseconds,
        observedAt: '2026-01-01T00:00:00.000Z',
        observations: [],
        sampleCount: 1,
        work
    };
}

function runtimeWithHedging(plan: PlacementPlan): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(plan);
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool hedge dispatch fixture requires worker-pool execution facts.');
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

function runtimeWithSampledHedging(plan: PlacementPlan, unit: WorkUnit): WorkerPoolRunRuntime {
    const runtime = runtimeWithHedging(plan);

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                durationHistory: {
                    generatedAt: '2026-01-01T00:00:00.000Z',
                    samples: [ durationSample(firstWork(unit), 100_000) ],
                    source: 'runtime-state-index'
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

function disposableIsolatedUnit(): WorkUnit {
    const unit = hedgeSafeUnit();

    return {
        ...unit,
        resourceConstraints: {
            ...unit.resourceConstraints,
            duplicateExecution: [ 'disposable-isolated' ]
        },
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

function pullRequiredLease(
    dispatcher: WorkerPoolWorkDispatcher,
    lane: PlacementLane
): WorkerPoolUnitLease {
    const lease = dispatcher.pull(lane);

    if (lease === null) {
        throw new Error('Worker-pool hedge dispatch fixture expected a lease.');
    }

    return lease;
}

function primaryLease(unit: WorkUnit, lane: PlacementLane): WorkerPoolUnitLease {
    return {
        kind: 'primary',
        lane,
        reservation: {
            faultDomains: [],
            hardKeys: []
        },
        traceUnit: unit.id,
        unit
    };
}

function hedgeDispatchState(
    runtime: WorkerPoolRunRuntime,
    plan: PlacementPlan,
    activeUnits: readonly HedgeActiveUnitLease[],
    duplicateWork: ReadonlySet<string>
): HedgeDispatchState {
    const unit = firstUnit(plan);

    return {
        activeUnits: new Map(activeUnits.map(function toEntry(entry) {
            return [ JSON.stringify(entry.lease.traceUnit), entry ];
        })),
        duplicateWork,
        lifecycleByLane: new Map(plan.lanes.map(function toLifecycleEntry(lane) {
            return [ lane.id, unit.workerLifecycle ];
        })),
        resolvedRun: runtime.resolvedRun,
        wallClock: runtime.dependencies.wallClock
    };
}

function activeHedgeLease(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): HedgeActiveUnitLease {
    return {
        lane: firstLane(plan),
        lease: primaryLease(firstUnit(plan), firstLane(plan)),
        startedAtMicroseconds: runtime.dependencies.wallClock.currentMonotonicMicroseconds - 50_000
    };
}

function readyHedgeLease(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): HedgeActiveUnitLease {
    return {
        ...activeHedgeLease(runtime, plan),
        startedAtMicroseconds: runtime.dependencies.wallClock.currentMonotonicMicroseconds - 100_000
    };
}

function assertEarlyHedgeDelay(
    scope: OverkillScope,
    state: HedgeDispatchState,
    lane: PlacementLane
): void {
    scope.assert.equal(laneHasPotentialHedge(state, lane), true);
    scope.assert.equal(hedgeWakeDelay(state, lane), 50);
    scope.assert.equal(selectHedgeCandidate(state, lane), null);
}

function assertSampledHedgeDelay(scope: OverkillScope): void {
    const unit = hedgeSafeUnit();
    const plan = twoLanePlan(unit);
    const runtime = runtimeWithSampledHedging(plan, unit);
    const earlyState = hedgeDispatchState(runtime, plan, [ activeHedgeLease(runtime, plan) ], new Set());
    const readyEntry = readyHedgeLease(runtime, plan);
    const readyState = hedgeDispatchState(runtime, plan, [ readyEntry ], new Set());

    assertEarlyHedgeDelay(scope, earlyState, secondLane(plan));
    scope.assert.equal(hedgeWakeDelay(readyState, secondLane(plan)), 0);
    scope.assert.equal(selectHedgeCandidate(readyState, secondLane(plan)), readyEntry);
}

function assertDuplicateHedgeSuppression(scope: OverkillScope): void {
    const unit = hedgeSafeUnit();
    const plan = twoLanePlan(unit);
    const runtime = runtimeWithHedging(plan);
    const entry = readyHedgeLease(runtime, plan);
    const state = hedgeDispatchState(runtime, plan, [ entry ], new Set([ unitHedgeWorkKey(unit) ]));

    scope.assert.equal(laneHasPotentialHedge(state, secondLane(plan)), false);
    scope.assert.equal(hedgeWakeDelay(state, secondLane(plan)), null);
    scope.assert.equal(selectHedgeCandidate(state, secondLane(plan)), null);
}

function assertIdleHedgeCheckClears(scope: OverkillScope): void {
    const unit = hedgeSafeUnit();
    const plan = splitCandidatePlan(unit);
    const dispatcher = createWorkDispatcher(runtimeWithSampledHedging(plan, unit), plan);
    const filler = pullRequiredLease(dispatcher, secondLane(plan));

    pullRequiredLease(dispatcher, firstLane(plan));
    dispatcher.finish(filler, false);
    scope.assert.equal(dispatcher.blocked(secondLane(plan)), false);
    dispatcher.clear();
    scope.assert.equal(dispatcher.pull(secondLane(plan)), null);
}

function assertHedgingOffSuppressesPotential(scope: OverkillScope): void {
    const unit = hedgeSafeUnit();
    const plan = twoLanePlan(unit);
    const runtime = fakeWorkerRuntime(plan);
    const entry = readyHedgeLease(runtime, plan);
    const state = hedgeDispatchState(runtime, plan, [ entry ], new Set());

    scope.assert.equal(laneHasPotentialHedge(state, secondLane(plan)), false);
    scope.assert.equal(hedgeWakeDelay(state, secondLane(plan)), null);
    scope.assert.equal(selectHedgeCandidate(state, secondLane(plan)), null);
}

function assertDisposableIsolatedHedge(scope: OverkillScope): void {
    const unit = disposableIsolatedUnit();
    const plan = twoLanePlan(unit);
    const runtime = runtimeWithHedging(plan);
    const entry = readyHedgeLease(runtime, plan);
    const state = hedgeDispatchState(runtime, plan, [ entry ], new Set());

    scope.assert.equal(laneHasPotentialHedge(state, secondLane(plan)), true);
    scope.assert.equal(selectHedgeCandidate(state, secondLane(plan)), entry);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-hedge-dispatch.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch waits for sampled duration thresholds',
            body(scope: OverkillScope) {
                assertSampledHedgeDelay(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch suppresses repeated duplicates',
            body(scope: OverkillScope) {
                assertDuplicateHedgeSuppression(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool dynamic dispatcher clears after idle hedge checks',
            body(scope: OverkillScope) {
                assertIdleHedgeCheckClears(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch ignores disabled hedging',
            body(scope: OverkillScope) {
                assertHedgingOffSuppressesPotential(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch accepts disposable isolated fresh workers',
            body(scope: OverkillScope) {
                assertDisposableIsolatedHedge(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
