import type {
    PlacementLane,
    PlacementPlan,
    WorkUnit
} from './run-types.ts';
import {
    faultReservationKey,
    uniqueText
} from './worker-pool-dispatch-state.ts';

type FaultQuotaLedger = {
    readonly quotas: () => ReadonlyMap<string, number>;
    readonly record: (unit: WorkUnit, laneId: string) => void;
};

function unitByKey(units: readonly WorkUnit[]): ReadonlyMap<string, WorkUnit> {
    return new Map(units.map(function toEntry(unit) {
        return [ JSON.stringify(unit.id), unit ];
    }));
}

function knownUnit(units: ReadonlyMap<string, WorkUnit>, unitId: WorkUnit['id']): WorkUnit {
    const unit = units.get(JSON.stringify(unitId));

    if (unit === undefined) {
        throw new Error('Placement assignment referenced an unknown work unit.');
    }

    return unit;
}

export function assignedWorkUnits(plan: PlacementPlan): readonly WorkUnit[] {
    const units = unitByKey(plan.units);

    return plan.assignments.map(function toUnit(assignment) {
        return knownUnit(units, assignment.unit);
    });
}

export function laneLifecycles(plan: PlacementPlan): ReadonlyMap<string, WorkUnit['workerLifecycle']> {
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

function createFaultQuotaLedger(lanes: readonly PlacementLane[]): FaultQuotaLedger {
    const quotas = new Map<string, number>();
    const lanesById = new Map(lanes.map(function toLaneEntry(lane) {
        return [ lane.id, lane ];
    }));

    return {
        quotas() {
            return quotas;
        },
        record(unit, laneId) {
            const lane = lanesById.get(laneId);

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

export function faultQuotas(plan: PlacementPlan): ReadonlyMap<string, number> {
    const ledger = createFaultQuotaLedger(plan.lanes);
    const units = unitByKey(plan.units);

    for (const assignment of plan.assignments) {
        ledger.record(knownUnit(units, assignment.unit), assignment.lane);
    }

    return ledger.quotas();
}
