import { workIdentityKey } from '../engine/identity.ts';
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
    type LeaseCounter,
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

export type WorkerPoolUnitLease = {
    readonly lane: PlacementLane;
    readonly reservation: LeaseReservation;
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

type WorkerPoolRequeuedUnit = {
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type WorkerPoolWorkDispatcher = {
    readonly blocked: (lane: PlacementLane) => boolean;
    readonly clear: () => void;
    readonly finish: (lease: WorkerPoolUnitLease, keepReservation: boolean) => void;
    readonly pull: (lane: PlacementLane) => WorkerPoolUnitLease | null;
    readonly requeue: (unit: WorkerPoolRequeuedUnit) => void;
    readonly waitForChange: () => Promise<void>;
};

type LeaseReservation = {
    readonly faultDomains: readonly string[];
    readonly hardKeys: readonly string[];
};

type UnitLoad = (unit: WorkUnit) => number;

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

type DynamicDispatchState = {
    readonly activeLeases: LeaseCounter;
    readonly lanes: readonly PlacementLane[];
    readonly lifecycleByLane: ReadonlyMap<string, WorkUnit['workerLifecycle']>;
    readonly pendingUnits: WorkUnitQueue<QueuedWorkUnit>;
    readonly quotas: ReadonlyMap<string, number>;
    readonly reservations: DynamicReservations;
    readonly runtime: WorkerPoolRunRuntime;
    readonly unitLoad: UnitLoad;
    readonly waiters: ChangeWaiters;
};

const medianDivisor = 2;
function workUnitIdKey(unit: WorkUnit['id']): string {
    return JSON.stringify(unit);
}

function unitKey(unit: WorkUnit): string {
    return workUnitIdKey(unit.id);
}

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

function unitsAssignedToLane(plan: PlacementPlan, lane: PlacementLane): readonly WorkUnit[] {
    const units = unitByKey(plan.units);

    return plan.assignments.flatMap(function toUnit(assignment) {
        if (assignment.lane !== lane.id) {
            return [];
        }

        return [ knownUnit(units, assignment.unit) ];
    });
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

function createStaticDispatcher(plan: PlacementPlan): WorkerPoolWorkDispatcher {
    const queues = new Map(plan.lanes.map(function toLaneQueue(lane) {
        return [ lane.id, createWorkUnitQueue(unitsAssignedToLane(plan, lane)) ];
    }));
    const assignedLaneByUnit = new Map(plan.assignments.map(function toAssignmentEntry(assignment) {
        return [ JSON.stringify(assignment.unit), assignment.lane ];
    }));

    return {
        blocked() {
            return false;
        },
        clear() {
            for (const queue of queues.values()) {
                queue.clear();
            }
        },
        finish() {
            return undefined;
        },
        pull(lane) {
            const unit = queues.get(lane.id)?.takeFirst() ?? null;

            return unit === null
                ? null
                : { lane, reservation: { faultDomains: [], hardKeys: [] }, traceUnit: unit.id, unit };
        },
        requeue(requeuedUnit) {
            const lane = assignedLaneByUnit.get(unitKey(requeuedUnit.unit));

            if (lane === undefined) {
                throw new Error('Static worker-pool dispatch cannot requeue an unassigned work unit.');
            }

            queues.get(lane)?.push(requeuedUnit.unit);
        },
        async waitForChange() {
            return undefined;
        }
    };
}

function median(values: readonly number[]): number {
    const sorted = values.toSorted(function compareNumber(left, right) {
        return left - right;
    });
    const middle = Math.floor(sorted.length / medianDivisor);
    const value = sorted[middle];

    if (value === undefined) {
        return 0;
    }

    return sorted.length % medianDivisor === 1
        ? value
        : ((sorted[middle - 1] ?? value) + value) / medianDivisor;
}

function caseCountLoad(unit: WorkUnit): number {
    return unit.work.length + unit.resourceConstraints.capacityWeight - 1;
}

function durationHistoryUnitLoad(
    samples: NonNullable<WorkerPoolRunRuntime['resolvedRun']['facts']['durationHistory']>['samples']
): UnitLoad {
    const fallbackDuration = median(samples.map(function toDuration(sample) {
        return sample.durationMilliseconds;
    }));
    const durationByWorkKey = new Map(samples.map(function toEntry(sample) {
        return [ workIdentityKey(sample.work), sample.durationMilliseconds ];
    }));

    return function unitDuration(unit) {
        return unit.work.reduce(function sumDuration(total, work) {
            return total + (durationByWorkKey.get(workIdentityKey(work)) ?? fallbackDuration);
        }, 0) * unit.resourceConstraints.capacityWeight;
    };
}

function durationHistoryLoad(runtime: WorkerPoolRunRuntime): UnitLoad | null {
    const { durationHistory, execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool' || execution.assignmentPolicy !== 'duration-history-balanced') {
        return null;
    }

    if (durationHistory === null || durationHistory.samples.length === 0) {
        return null;
    }

    return durationHistoryUnitLoad(durationHistory.samples);
}

function runtimeUnitLoad(runtime: WorkerPoolRunRuntime): UnitLoad {
    return durationHistoryLoad(runtime) ?? caseCountLoad;
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
        lanes: plan.lanes,
        lifecycleByLane: laneLifecycles(plan),
        pendingUnits: createWorkUnitQueue(pendingUnits),
        quotas: faultQuotas(plan),
        reservations: createDynamicReservations(),
        runtime,
        unitLoad: runtimeUnitLoad(runtime),
        waiters: createChangeWaiters()
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

function blocked(state: DynamicDispatchState, lane: PlacementLane): boolean {
    return state.activeLeases.active() > 0 && state.pendingUnits.all().some(function hasBlockedUnit(item) {
        return laneMatchesRetainedReservation(state, item, lane) && laneMatchesLifecycle(state, item, lane);
    });
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
    state.pendingUnits.remove(item);
    state.activeLeases.increment();

    return {
        lane,
        reservation: reserve(state, item, lane),
        traceUnit: item.traceUnit,
        unit: item.unit
    };
}

function pull(state: DynamicDispatchState, lane: PlacementLane): WorkerPoolUnitLease | null {
    let item = selectPendingUnit(state, lane);

    while (item !== undefined && queuedWorkCanSplit(item, splitEligibility(state, item))) {
        splitPendingUnit(state, item);
        item = selectPendingUnit(state, lane);
    }

    return item === undefined ? null : leasePendingUnit(state, lane, item);
}

function createDynamicDispatcher(runtime: WorkerPoolRunRuntime, plan: PlacementPlan): WorkerPoolWorkDispatcher {
    const state = createDynamicDispatchState(runtime, plan);

    return {
        blocked(lane) {
            return blocked(state, lane);
        },
        clear() {
            state.pendingUnits.clear();
            state.waiters.notify();
        },
        finish(lease, keepReservation) {
            state.activeLeases.decrement();

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
