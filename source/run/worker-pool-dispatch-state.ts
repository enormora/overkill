import type { PlacementLane, WorkUnit } from './run-types.ts';
import { traceUnitKey, type TraceWorkUnitId } from './placement-trace.ts';

export type WorkUnitQueue<T> = {
    readonly all: () => readonly T[];
    readonly clear: () => void;
    readonly push: (unit: T) => void;
    readonly pushMany: (units: readonly T[]) => void;
    readonly remove: (unit: T) => void;
    readonly takeFirst: () => T | null;
};

export type LeaseCounter = {
    readonly active: () => number;
    readonly decrement: () => void;
    readonly increment: () => void;
};

export type ChangeWaiters = {
    readonly notify: () => void;
    readonly wait: () => Promise<void>;
};

export type LeaseReservation = {
    readonly faultDomains: readonly string[];
    readonly hardKeys: readonly string[];
};

export type DynamicReservations = {
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

export type WorkerPoolLeaseMember = {
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type WorkerPoolUnitLease = {
    readonly envelopeId: string | null;
    readonly kind: 'hedged-duplicate' | 'primary';
    readonly lane: PlacementLane;
    readonly members: readonly [WorkerPoolLeaseMember, ...(readonly WorkerPoolLeaseMember[])];
    readonly reservation: LeaseReservation;
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

type WorkerPoolFinishOutcome = {
    readonly learnWarmth: boolean;
    readonly retainReservation: boolean;
    readonly workerCrashed: boolean;
};

type WorkerPoolRequeuedUnit = {
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type WorkerPoolWorkDispatcher = {
    readonly blocked: (lane: PlacementLane) => boolean;
    readonly clear: () => void;
    readonly finish: (lease: WorkerPoolUnitLease, outcome: WorkerPoolFinishOutcome) => void;
    readonly pull: (lane: PlacementLane) => WorkerPoolUnitLease | null;
    readonly requeue: (unit: WorkerPoolRequeuedUnit) => void;
    readonly waitForChange: () => Promise<void>;
};

export function workerPoolLeaseKey(lease: WorkerPoolUnitLease): string {
    return JSON.stringify([ lease.kind, lease.envelopeId, traceUnitKey(lease.traceUnit), lease.lane.id ]);
}

export function uniqueText(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values));
}

export function hardConstraintKeys(unit: WorkUnit): readonly string[] {
    return uniqueText([
        ...unit.resourceConstraints.serialKeys,
        ...unit.resourceConstraints.singleWorkerKeys
    ]);
}

export function faultReservationKey(faultDomain: string, lane: PlacementLane): string {
    return JSON.stringify([ faultDomain, lane.id ]);
}

export function createDynamicReservations(): DynamicReservations {
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

export function createWorkUnitQueue<T>(initialUnits: readonly T[]): WorkUnitQueue<T> {
    let units = Array.from(initialUnits);

    return {
        all() {
            return units;
        },
        clear() {
            units = [];
        },
        push(unit) {
            units = [ ...units, unit ];
        },
        pushMany(nextUnits) {
            units = [ ...units, ...nextUnits ];
        },
        remove(unit) {
            units = units.filter(function keep(candidate) {
                return candidate !== unit;
            });
        },
        takeFirst() {
            const [ unit, ...remaining ] = units;

            units = remaining;

            return unit ?? null;
        }
    };
}

export function createLeaseCounter(): LeaseCounter {
    let count = 0;

    return {
        active() {
            return count;
        },
        decrement() {
            count -= 1;
        },
        increment() {
            count += 1;
        }
    };
}

export function createChangeWaiters(): ChangeWaiters {
    let waiters: readonly (() => void)[] = [];

    return {
        notify() {
            const currentWaiters = waiters;

            waiters = [];

            for (const resolve of currentWaiters) {
                resolve();
            }
        },
        async wait() {
            await new Promise<void>(function waitForChange(resolve) {
                waiters = [ ...waiters, resolve ];
            });
        }
    };
}
