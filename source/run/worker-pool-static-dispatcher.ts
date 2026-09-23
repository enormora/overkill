import type { PlacementLane, PlacementPlan, WorkUnit } from './run-types.ts';
import { createWorkUnitQueue, type WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';

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

export function createStaticDispatcher(plan: PlacementPlan): WorkerPoolWorkDispatcher {
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
                : {
                    envelopeId: null,
                    kind: 'primary',
                    lane,
                    members: [ { traceUnit: unit.id, unit } ],
                    reservation: { faultDomains: [], hardKeys: [] },
                    traceUnit: unit.id,
                    unit
                };
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
