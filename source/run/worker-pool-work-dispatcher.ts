import {
    createStoredRunValue,
    type StoredRunValue
} from './supervised-run-state.ts';
import type {
    PlacementLane,
    PlacementPlan,
    WorkUnit
} from './run-types.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import {
    assignedWorkUnits,
    faultQuotas,
    laneLifecycles
} from './worker-pool-dynamic-plan.ts';
import {
    createChangeWaiters,
    createDynamicReservations,
    createLeaseCounter,
    createWorkUnitQueue,
    type ChangeWaiters,
    type DynamicReservations,
    type LeaseReservation,
    type LeaseCounter,
    type WorkerPoolUnitLease,
    type WorkerPoolWorkDispatcher,
    type WorkUnitQueue,
    faultReservationKey,
    hardConstraintKeys,
    uniqueText,
    workerPoolLeaseKey
} from './worker-pool-dispatch-state.ts';
import {
    compareQueuePriority,
    fixedQueueItem,
    originalQueueItem,
    queuedWorkCanSplit,
    requeuedPriority,
    splitQueuedWorkUnit,
    type QueuedWorkUnit,
    type SplitEligibility
} from './worker-pool-pending-splitting.ts';
import { runtimeUnitLoad, type UnitLoad } from './worker-pool-work-load.ts';
import {
    hedgeWakeDelay,
    laneHasPotentialHedge,
    selectHedgeCandidate,
    type HedgeActiveUnitLease,
    type HedgeDispatchState,
    unitHedgeWorkKey
} from './worker-pool-hedge-dispatch.ts';
import { createStaticDispatcher } from './worker-pool-static-dispatcher.ts';
import {
    compatibleBatchLeaseParts,
    createWarmLaneAffinity,
    selectWarmPendingUnit,
    type WarmLaneAffinity
} from './worker-pool-lease-selection.ts';

type DynamicDispatchState = HedgeDispatchState & {
    readonly activeLeases: LeaseCounter;
    readonly activeUnits: ActiveUnitLeases;
    readonly batchId: StoredRunValue<number>;
    readonly duplicateWork: DuplicateWorkLedger;
    readonly hedgeWakeTimeout: StoredRunValue<
        ReturnType<WorkerPoolRunRuntime['dependencies']['wallClock']['setTimeout']> | null
    >;
    readonly lanes: readonly PlacementLane[];
    readonly lifecycleByLane: ReadonlyMap<string, WorkUnit['workerLifecycle']>;
    readonly pendingUnits: WorkUnitQueue<QueuedWorkUnit>;
    readonly quotas: ReadonlyMap<string, number>;
    readonly reservations: DynamicReservations;
    readonly runtime: WorkerPoolRunRuntime;
    readonly unitLoad: UnitLoad;
    readonly waiters: ChangeWaiters;
    readonly warmLaneAffinity: WarmLaneAffinity;
};
type HedgeWakeTimeout = DynamicDispatchState['hedgeWakeTimeout'] extends StoredRunValue<infer Value> ? Value : never;

type ActiveUnitLease = HedgeActiveUnitLease;
type ActiveUnitLeases = {
    readonly delete: (key: string) => boolean;
    readonly set: (key: string, value: ActiveUnitLease) => unknown;
    readonly values: () => IterableIterator<ActiveUnitLease>;
};
type DuplicateWorkLedger = {
    readonly add: (key: string) => unknown;
    readonly delete: (key: string) => boolean;
    readonly has: (key: string) => boolean;
};

function createDynamicDispatchState(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): DynamicDispatchState {
    const pendingUnits = assignedWorkUnits(plan).map(originalQueueItem);

    return {
        activeLeases: createLeaseCounter(),
        activeUnits: new Map(),
        batchId: createStoredRunValue(0),
        duplicateWork: new Set(),
        hedgeWakeTimeout: createStoredRunValue<HedgeWakeTimeout>(null),
        lanes: plan.lanes,
        lifecycleByLane: laneLifecycles(plan),
        pendingUnits: createWorkUnitQueue(pendingUnits),
        quotas: faultQuotas(plan),
        reservations: createDynamicReservations(),
        runtime,
        resolvedRun: runtime.resolvedRun,
        unitLoad: runtimeUnitLoad(runtime),
        waiters: createChangeWaiters(),
        warmLaneAffinity: createWarmLaneAffinity(),
        wallClock: runtime.dependencies.wallClock
    };
}

function laneMatchesLifecycle(state: DynamicDispatchState, item: QueuedWorkUnit, lane: PlacementLane): boolean {
    return state.lifecycleByLane.get(lane.id) === item.unit.workerLifecycle;
}

function laneMatchesRetainedReservation(
    state: DynamicDispatchState,
    item: QueuedWorkUnit,
    lane: PlacementLane
): boolean {
    const retainedLane = state.reservations.retainedLane(item.traceUnit);

    return retainedLane === undefined || retainedLane === lane.id;
}

function laneMatchesHardKeys(state: DynamicDispatchState, item: QueuedWorkUnit, lane: PlacementLane): boolean {
    return hardConstraintKeys(item.unit).every(function keyMatchesLane(key) {
        const boundLane = state.reservations.boundHardLane(key);

        return boundLane === undefined || boundLane === lane.id;
    });
}

function laneHasFaultCapacity(state: DynamicDispatchState, item: QueuedWorkUnit, lane: PlacementLane): boolean {
    if (state.reservations.retainedLane(item.traceUnit) === lane.id) {
        return true;
    }

    return uniqueText(item.unit.resourceConstraints.faultDomains).every(function domainHasCapacity(faultDomain) {
        const key = faultReservationKey(faultDomain, lane);

        return state.reservations.reservedFaultCount(faultDomain, lane) < (state.quotas.get(key) ?? 0);
    });
}

function laneCanLease(state: DynamicDispatchState, item: QueuedWorkUnit, lane: PlacementLane): boolean {
    return laneMatchesRetainedReservation(state, item, lane) &&
        laneMatchesLifecycle(state, item, lane) &&
        laneMatchesHardKeys(state, item, lane) &&
        laneHasFaultCapacity(state, item, lane);
}

function comparePriority(state: DynamicDispatchState, left: QueuedWorkUnit, right: QueuedWorkUnit): number {
    const loadDifference = state.unitLoad(right.unit) - state.unitLoad(left.unit);

    if (loadDifference !== 0) {
        return loadDifference;
    }

    return compareQueuePriority(left.priority, right.priority);
}

function freshReservation(state: DynamicDispatchState, unit: WorkUnit, lane: PlacementLane): LeaseReservation {
    const hardKeys = hardConstraintKeys(unit).filter(function bindHardKey(key) {
        if (state.reservations.hardKeyIsBound(key)) {
            return false;
        }

        state.reservations.bindHardLane(key, lane);

        return true;
    });
    const faultDomains = uniqueText(unit.resourceConstraints.faultDomains);

    for (const faultDomain of faultDomains) {
        state.reservations.incrementFault(faultDomain, lane);
    }

    return { faultDomains, hardKeys };
}

function reserve(state: DynamicDispatchState, item: QueuedWorkUnit, lane: PlacementLane): LeaseReservation {
    if (state.reservations.retainedLane(item.traceUnit) === lane.id) {
        return { faultDomains: [], hardKeys: [] };
    }

    return freshReservation(state, item.unit, lane);
}

function release(state: DynamicDispatchState, lease: WorkerPoolUnitLease): void {
    for (const hardKey of lease.reservation.hardKeys) {
        state.reservations.releaseHardLane(hardKey, lease.lane);
    }

    for (const faultDomain of lease.reservation.faultDomains) {
        state.reservations.decrementFault(faultDomain, lease.lane);
    }
}

function recordActiveLease(state: DynamicDispatchState, lease: WorkerPoolUnitLease): void {
    state.activeLeases.increment();
    state.activeUnits.set(workerPoolLeaseKey(lease), {
        lane: lease.lane,
        lease,
        startedAtMicroseconds: state.runtime.dependencies.wallClock.currentMonotonicMicroseconds
    });

    if (lease.kind === 'hedged-duplicate') {
        state.duplicateWork.add(unitHedgeWorkKey(lease.unit));
    }
}

function clearHedgeWakeTimeout(state: DynamicDispatchState): void {
    const timeout = state.hedgeWakeTimeout.read();

    if (timeout !== null) {
        state.runtime.dependencies.wallClock.clearTimeout(timeout);
        state.hedgeWakeTimeout.write(null);
    }
}

function scheduleHedgeWake(state: DynamicDispatchState, lane: PlacementLane): void {
    if (state.hedgeWakeTimeout.read() !== null) {
        return;
    }

    const delay = hedgeWakeDelay(state, lane);

    if (delay !== null) {
        const timeout = state.runtime.dependencies.wallClock.setTimeout(function notifyHedgeWaiter() {
            state.hedgeWakeTimeout.write(null);
            state.waiters.notify();
        }, delay);

        state.hedgeWakeTimeout.write(timeout);
    }
}

function hasPotentialHedge(state: DynamicDispatchState, lane: PlacementLane): boolean {
    scheduleHedgeWake(state, lane);

    return laneHasPotentialHedge(state, lane);
}

function blocked(state: DynamicDispatchState, lane: PlacementLane): boolean {
    return state.activeLeases.active() > 0 && (
        state.pendingUnits.all().some(function hasBlockedUnit(item) {
            return laneMatchesRetainedReservation(state, item, lane) && laneMatchesLifecycle(state, item, lane);
        }) || hasPotentialHedge(state, lane)
    );
}

function compatibleLaneCount(state: DynamicDispatchState, item: QueuedWorkUnit): number {
    return state
        .lanes
        .filter(function canLeaseParent(lane) {
            return laneCanLease(state, item, lane);
        })
        .length;
}

function splitEligibility(state: DynamicDispatchState, item: QueuedWorkUnit): SplitEligibility {
    return {
        compatibleLaneCount: compatibleLaneCount(state, item),
        hardConstraintCount: hardConstraintKeys(item.unit).length
    };
}

function splitPendingUnit(state: DynamicDispatchState, item: QueuedWorkUnit): void {
    const split = splitQueuedWorkUnit(state.runtime, item);

    state.pendingUnits.remove(item);
    state.pendingUnits.pushMany(split.children);
    state.runtime.recordPlacementTraceEntry(split.traceEntry);
}

function selectPendingUnit(state: DynamicDispatchState, lane: PlacementLane): QueuedWorkUnit | undefined {
    const candidates = state
        .pendingUnits
        .all()
        .filter(function isEligible(candidate) {
            return laneCanLease(state, candidate, lane);
        })
        .toSorted(function compareUnits(left, right) {
            return comparePriority(state, left, right);
        });
    const [ firstCandidate ] = candidates;

    if (firstCandidate === undefined) {
        return undefined;
    }

    const selection = selectWarmPendingUnit({
        candidates: [ firstCandidate, ...candidates.slice(1) ],
        lane,
        laneCount: state.lanes.length,
        unitLoad: state.unitLoad,
        warmLaneAffinity: state.warmLaneAffinity
    });

    if (selection.traceEntry !== null) {
        state.runtime.recordPlacementTraceEntry(selection.traceEntry);
    }

    return selection.item;
}

function leasePendingUnit(state: DynamicDispatchState, lane: PlacementLane, item: QueuedWorkUnit): WorkerPoolUnitLease {
    const batch = compatibleBatchLeaseParts(state, item, {
        comparePriority(left, right) {
            return comparePriority(state, left, right);
        },
        compatibleLaneCount(candidate) {
            return compatibleLaneCount(state, candidate);
        },
        laneCanLease(candidate) {
            return laneCanLease(state, candidate, lane);
        },
        reserve(member) {
            return reserve(state, member, lane);
        }
    });

    for (const member of batch.members) {
        state.pendingUnits.remove(member);
    }

    const lease: WorkerPoolUnitLease = {
        envelopeId: batch.envelopeId,
        kind: 'primary',
        lane,
        members: batch.leaseMembers,
        reservation: batch.reservation,
        traceUnit: item.traceUnit,
        unit: item.unit
    };

    recordActiveLease(state, lease);

    return lease;
}

function leaseHedgedDuplicate(
    state: DynamicDispatchState,
    lane: PlacementLane,
    active: ActiveUnitLease
): WorkerPoolUnitLease {
    const lease: WorkerPoolUnitLease = {
        envelopeId: null,
        kind: 'hedged-duplicate',
        lane,
        members: [ { traceUnit: active.lease.traceUnit, unit: active.lease.unit } ],
        reservation: freshReservation(state, active.lease.unit, lane),
        traceUnit: active.lease.traceUnit,
        unit: active.lease.unit
    };

    recordActiveLease(state, lease);
    state.runtime.recordPlacementTraceEntry({
        kind: 'hedged-duplicate-started',
        unit: lease.traceUnit,
        workerId: lane.id
    });

    return lease;
}

function pull(state: DynamicDispatchState, lane: PlacementLane): WorkerPoolUnitLease | null {
    let item = selectPendingUnit(state, lane);

    while (item !== undefined && queuedWorkCanSplit(item, splitEligibility(state, item))) {
        splitPendingUnit(state, item);
        item = selectPendingUnit(state, lane);
    }

    if (item !== undefined) {
        return leasePendingUnit(state, lane, item);
    }

    const hedgeCandidate = selectHedgeCandidate(state, lane);

    return hedgeCandidate === null ? null : leaseHedgedDuplicate(state, lane, hedgeCandidate);
}

function finishWarmLaneAffinity(
    state: DynamicDispatchState,
    lease: WorkerPoolUnitLease,
    outcome: Parameters<WorkerPoolWorkDispatcher['finish']>[1]
): void {
    if (outcome.workerCrashed) {
        state.warmLaneAffinity.clear(lease.lane);
    }

    if (outcome.learnWarmth) {
        state.warmLaneAffinity.learn(
            lease.lane,
            lease.members.map(function toUnit(member) {
                return member.unit;
            })
        );
    }
}

function finishReservation(
    state: DynamicDispatchState,
    lease: WorkerPoolUnitLease,
    outcome: Parameters<WorkerPoolWorkDispatcher['finish']>[1]
): void {
    if (outcome.retainReservation) {
        state.reservations.retainUnit(lease.traceUnit, lease.lane);
    } else {
        release(state, lease);
    }
}

function finishLease(
    state: DynamicDispatchState,
    lease: WorkerPoolUnitLease,
    outcome: Parameters<WorkerPoolWorkDispatcher['finish']>[1]
): void {
    state.activeLeases.decrement();
    state.activeUnits.delete(workerPoolLeaseKey(lease));

    if (lease.kind === 'hedged-duplicate') {
        state.duplicateWork.delete(unitHedgeWorkKey(lease.unit));
    }

    finishWarmLaneAffinity(state, lease, outcome);
    finishReservation(state, lease, outcome);
    state.waiters.notify();
}

function createDynamicDispatcher(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): WorkerPoolWorkDispatcher {
    const state = createDynamicDispatchState(runtime, plan);

    return {
        blocked(lane) {
            return blocked(state, lane);
        },
        clear() {
            clearHedgeWakeTimeout(state);
            state.pendingUnits.clear();
            state.waiters.notify();
        },
        finish(lease, outcome) {
            finishLease(state, lease, outcome);
        },
        pull(lane) {
            return pull(state, lane);
        },
        requeue(requeuedUnit) {
            state.pendingUnits.push(fixedQueueItem(requeuedUnit.unit, requeuedUnit.traceUnit, requeuedPriority()));
            state.waiters.notify();
        },
        async waitForChange() {
            await state.waiters.wait();
        }
    };
}

export function createWorkDispatcher(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): WorkerPoolWorkDispatcher {
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool' || execution.dispatchPolicy === 'static-assignment') {
        return createStaticDispatcher(plan);
    }

    return createDynamicDispatcher(runtime, plan);
}
