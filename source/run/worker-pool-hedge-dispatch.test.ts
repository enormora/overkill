import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';

import type { PlacementPlan } from './run-types.ts';
import { fakeWorkerRuntime, placementPlan, testCaseMetadata } from './worker-pool-placement-validation.test.ts';
import type { WorkerPoolUnitLease, WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';
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
        resourceOwnership: { owners: [] },
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
        resourceOwnership: { owners: [] },
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
        envelopeId: null,
        kind: 'primary',
        lane,
        members: [ { attempt: 'attempt-1', traceUnit: unit.id, unit } ],
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
        laneCanLeaseHedgeCandidate() {
            return true;
        },
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
        startedAtMicroseconds: Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds) - 50_000
    };
}

function readyHedgeLease(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): HedgeActiveUnitLease {
    return {
        ...activeHedgeLease(runtime, plan),
        startedAtMicroseconds: Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds) - 100_000
    };
}

const assertIncompatibleLaneSuppressesHedge = defineCompositeAssertion({
    name: 'incompatible lane suppresses hedge',
    assert(check) {
        const unit = hedgeSafeUnit();
        const plan = twoLanePlan(unit);
        const runtime = runtimeWithHedging(plan);
        const entry = readyHedgeLease(runtime, plan);
        const state: HedgeDispatchState = {
            ...hedgeDispatchState(runtime, plan, [ entry ], new Set()),
            laneCanLeaseHedgeCandidate() {
                return false;
            }
        };
        return check.group([
            check.equal(laneHasPotentialHedge(state, secondLane(plan)), false),
            check.equal(selectHedgeCandidate(state, secondLane(plan)), null)
        ]);
    }
});

const earlyHedgeDelayChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    state: HedgeDispatchState,
    lane: PlacementLane
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(laneHasPotentialHedge(state, lane), true),
        check.equal(hedgeWakeDelay(state, lane), 50),
        check.equal(selectHedgeCandidate(state, lane), null)
    ]);
};

const assertSampledHedgeDelay = defineCompositeAssertion({
    name: 'sampled hedge delay',
    assert(check) {
        const unit = hedgeSafeUnit();
        const plan = twoLanePlan(unit);
        const runtime = runtimeWithSampledHedging(plan, unit);
        const earlyState = hedgeDispatchState(runtime, plan, [ activeHedgeLease(runtime, plan) ], new Set());
        const readyEntry = readyHedgeLease(runtime, plan);
        const readyState = hedgeDispatchState(runtime, plan, [ readyEntry ], new Set());
        return check.group([
            earlyHedgeDelayChecks(check.annotated('early hedge delay'), earlyState, secondLane(plan)),
            check.equal(hedgeWakeDelay(readyState, secondLane(plan)), 0),
            check.equal(selectHedgeCandidate(readyState, secondLane(plan)), readyEntry)
        ]);
    }
});

const assertDuplicateHedgeSuppression = defineCompositeAssertion({
    name: 'duplicate hedge suppression',
    assert(check) {
        const unit = hedgeSafeUnit();
        const plan = twoLanePlan(unit);
        const runtime = runtimeWithHedging(plan);
        const entry = readyHedgeLease(runtime, plan);
        const state = hedgeDispatchState(runtime, plan, [ entry ], new Set([ unitHedgeWorkKey(unit) ]));
        return check.group([
            check.equal(laneHasPotentialHedge(state, secondLane(plan)), false),
            check.equal(hedgeWakeDelay(state, secondLane(plan)), null),
            check.equal(selectHedgeCandidate(state, secondLane(plan)), null)
        ]);
    }
});

const assertIdleHedgeCheckClears = defineCompositeAssertion({
    name: 'idle hedge check clears',
    assert(check) {
        const unit = hedgeSafeUnit();
        const plan = splitCandidatePlan(unit);
        const dispatcher = createWorkDispatcher(runtimeWithSampledHedging(plan, unit), plan);
        const filler = pullRequiredLease(dispatcher, secondLane(plan));
        pullRequiredLease(dispatcher, firstLane(plan));
        dispatcher.finish(filler, {
            learnWarmth: true,
            retainReservation: true,
            workerCrashed: false
        });
        const initialChecks = check.equal(dispatcher.blocked(secondLane(plan)), false);
        dispatcher.clear();
        return check.group([ initialChecks, check.equal(dispatcher.pull(secondLane(plan)), null) ]);
    }
});

const assertHedgingOffSuppressesPotential = defineCompositeAssertion({
    name: 'hedging off suppresses potential',
    assert(check) {
        const unit = hedgeSafeUnit();
        const plan = twoLanePlan(unit);
        const runtime = fakeWorkerRuntime(plan);
        const entry = readyHedgeLease(runtime, plan);
        const state = hedgeDispatchState(runtime, plan, [ entry ], new Set());
        return check.group([
            check.equal(laneHasPotentialHedge(state, secondLane(plan)), false),
            check.equal(hedgeWakeDelay(state, secondLane(plan)), null),
            check.equal(selectHedgeCandidate(state, secondLane(plan)), null)
        ]);
    }
});

const assertDisposableIsolatedHedge = defineCompositeAssertion({
    name: 'disposable isolated hedge',
    assert(check) {
        const unit = disposableIsolatedUnit();
        const plan = twoLanePlan(unit);
        const runtime = runtimeWithHedging(plan);
        const entry = readyHedgeLease(runtime, plan);
        const state = hedgeDispatchState(runtime, plan, [ entry ], new Set());
        return check.group([
            check.equal(laneHasPotentialHedge(state, secondLane(plan)), true),
            check.equal(selectHedgeCandidate(state, secondLane(plan)), entry)
        ]);
    }
});

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool hedge dispatch',
    children: [
        test({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch waits for sampled duration thresholds',
            body(scope) {
                scope.assert(assertSampledHedgeDelay);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch suppresses repeated duplicates',
            body(scope) {
                scope.assert(assertDuplicateHedgeSuppression);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'clears after idle hedge checks',
            body(scope) {
                scope.assert(assertIdleHedgeCheckClears);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch ignores disabled hedging',
            body(scope) {
                scope.assert(assertHedgingOffSuppressesPotential);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch accepts disposable isolated fresh workers',
            body(scope) {
                scope.assert(assertDisposableIsolatedHedge);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'worker-pool hedge dispatch rejects incompatible lanes',
            body(scope) {
                scope.assert(assertIncompatibleLaneSuppressesHedge);

                return scope.assert.collect();
            }
        })
    ]
});
