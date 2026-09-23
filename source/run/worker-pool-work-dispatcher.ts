import {
    createStoredRunValue,
    type StoredRunValue
} from './supervised-run-state.ts';
import type {
    PlacementLane,
    PlacementPlan,
    WorkUnit
} from './run-types.ts';
import { traceUnitKey, type TraceWorkUnitId } from './placement-trace.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import {
    createChangeWaiters,
    createLeaseCounter,
    createWorkUnitQueue,
    type ChangeWaiters,
    type LeaseReservation,
    type LeaseCounter,
    type WorkerPoolUnitLease,
    type WorkerPoolWorkDispatcher,
    type WorkUnitQueue
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
import { compatibleBatchLeaseParts } from './worker-pool-compatible-batching.ts';

type DynamicReservations = {
    readonly bindHardLane: (key: string, lane: PlacementLane) => void;
    readonly boundHardLane: (key: string) => string | undefined;
    readonly decrementFault: (faultDomain: string, lane: PlacementLane) => void;
    readonly hardKeyIsBound: (key: string) => boolean;
    readonly incrementFault: (faultDomain: string, lane: PlacementLane) => void;
    readonly releaseHardLane: (key: string, lane: PlacementLane) => void;
    readonly reservedFaultCount: (faultDomain: string, lane: PlacementLane) => number;
    readonly retainedLane: (traceUnit: TraceWorkUnitId) => string | undefined;
    readonly retainUnit: (traceUnit: TraceWorkUnitId, lane: PlacementLane) => void;
};

type FaultQuotaLedger = {
    readonly quotas: () => ReadonlyMap<string, number>;
    readonly record: (unit: WorkUnit, laneId: string) => void;
};

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

function unitByKey(units: readonly WorkUnit[]): ReadonlyMap<string, WorkUnit> {
    return new Map(units.map(function toEntry(unit) {
        return [ JSON.stringify(unit.id), unit ];
    }));
}

function uniqueText(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values));
}

function hardConstraintKeys(unit: WorkUnit): readonly string[] {
    return Array.from(
        new Set([
            ...unit.resourceConstraints.serialKeys,
            ...unit.resourceConstraints.singleWorkerKeys
        ])
    );
}

function faultReservationKey(faultDomain: string, lane: PlacementLane): string {
    return JSON.stringify([ faultDomain, lane.id ]);
}

function knownUnit(units: ReadonlyMap<string, WorkUnit>, unitId: WorkUnit['id']): WorkUnit {
    const unit = units.get(JSON.stringify(unitId));

    if (unit === undefined) {
        throw new Error('Placement assignment referenced an unknown work unit.');
    }

    return unit;
}

function createDynamicReservations(): DynamicReservations {
    const hardLaneByKey = new Map<string, string>();
    const reservedFaultCounts = new Map<string, number>();
    const retainedLaneByTraceUnit = new Map<string, string>();

    return {
        bindHardLane(key, lane) {
            hardLaneByKey.set(key, lane.id);
        },
        boundHardLane(key) {
            return hardLaneByKey.get(key);
        },
        decrementFault(faultDomain, lane) {
            const key = faultReservationKey(faultDomain, lane);
            const count = reservedFaultCounts.get(key) ?? 0;

            if (count <= 1) {
                reservedFaultCounts.delete(key);

                return;
            }

            reservedFaultCounts.set(key, count - 1);
        },
        hardKeyIsBound(key) {
            return hardLaneByKey.has(key);
        },
        incrementFault(faultDomain, lane) {
            const key = faultReservationKey(faultDomain, lane);

            reservedFaultCounts.set(key, (reservedFaultCounts.get(key) ?? 0) + 1);
        },
        releaseHardLane(key, lane) {
            if (hardLaneByKey.get(key) === lane.id) {
                hardLaneByKey.delete(key);
            }
        },
        reservedFaultCount(faultDomain, lane) {
            return reservedFaultCounts.get(faultReservationKey(faultDomain, lane)) ?? 0;
        },
        retainedLane(traceUnit) {
            return retainedLaneByTraceUnit.get(traceUnitKey(traceUnit));
        },
        retainUnit(traceUnit, lane) {
            retainedLaneByTraceUnit.set(traceUnitKey(traceUnit), lane.id);
        }
    };
}

function laneLifecycles(plan: PlacementPlan): ReadonlyMap<string, WorkUnit['workerLifecycle']> {
    const lifecycles = new Map<string, WorkUnit['workerLifecycle']>();
    const units = unitByKey(plan.units);

    for (const assignment of plan.assignments) {
        const unit = knownUnit(units, assignment.unit);
        const existing = lifecycles.get(assignment.lane);

        if (existing !== undefined && existing !== unit.workerLifecycle) {
            throw new Error('Placement lane cannot mix worker lifecycle policies.');
        }

        lifecycles.set(assignment.lane, unit.workerLifecycle);
    }

    return lifecycles;
}

function createFaultQuotaLedger(plan: PlacementPlan): FaultQuotaLedger {
    const quotas = new Map<string, number>();
    const lanes = new Map(plan.lanes.map(function toLaneEntry(lane) {
        return [ lane.id, lane ];
    }));

    return {
        quotas() {
            return quotas;
        },
        record(unit, laneId) {
            const lane = lanes.get(laneId);

            if (lane === undefined) {
                throw new Error('Placement assignment referenced an unknown lane.');
            }

            for (const faultDomain of uniqueText(unit.resourceConstraints.faultDomains)) {
                const key = faultReservationKey(faultDomain, lane);

                quotas.set(key, (quotas.get(key) ?? 0) + 1);
            }
        }
    };
}

function faultQuotas(plan: PlacementPlan): ReadonlyMap<string, number> {
    const ledger = createFaultQuotaLedger(plan);
    const units = unitByKey(plan.units);

    for (const assignment of plan.assignments) {
        ledger.record(knownUnit(units, assignment.unit), assignment.lane);
    }

    return ledger.quotas();
}

function createDynamicDispatchState(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): DynamicDispatchState {
    const units = unitByKey(plan.units);
    const pendingUnits = plan.assignments.map(function toUnit(assignment, index) {
        return originalQueueItem(knownUnit(units, assignment.unit), index);
    });

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

function activeLeaseKey(lease: WorkerPoolUnitLease): string {
    return JSON.stringify([ lease.kind, lease.envelopeId, traceUnitKey(lease.traceUnit), lease.lane.id ]);
}

function recordActiveLease(state: DynamicDispatchState, lease: WorkerPoolUnitLease): void {
    state.activeLeases.increment();
    state.activeUnits.set(activeLeaseKey(lease), {
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
    return state
        .pendingUnits
        .all()
        .filter(function isEligible(candidate) {
            return laneCanLease(state, candidate, lane);
        })
        .toSorted(function compareUnits(left, right) {
            return comparePriority(state, left, right);
        })[0];
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
        finish(lease, keepReservation) {
            state.activeLeases.decrement();
            state.activeUnits.delete(activeLeaseKey(lease));

            if (lease.kind === 'hedged-duplicate') {
                state.duplicateWork.delete(unitHedgeWorkKey(lease.unit));
            }

            if (keepReservation) {
                state.reservations.retainUnit(lease.traceUnit, lease.lane);
            } else {
                release(state, lease);
            }

            state.waiters.notify();
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
