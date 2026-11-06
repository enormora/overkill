import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import { traceUnitKey } from './placement-trace.ts';
import type { PlacementPlan } from './run-types.ts';

function assertUnique(values: readonly string[]): void {
    const unique = new Set(values);
    if (unique.size !== values.length) {
        throw new TypeError('Replay placement contains duplicate identities.');
    }
}
function assertAssignments(plan: PlacementPlan): void {
    const units = new Set(plan.units.map(function key(unit) {
        return traceUnitKey(unit.id);
    }));
    const lanes = new Set(plan.lanes.map(function key(lane) {
        return lane.id;
    }));
    const assignments = plan.assignments.map(function key(entry) {
        return traceUnitKey(entry.unit);
    });
    assertUnique(assignments);
    if (
        assignments.length !== units.size || plan.assignments.some(function unknown(entry) {
            return !units.has(traceUnitKey(entry.unit)) || !lanes.has(entry.lane);
        })
    ) {
        throw new TypeError('Replay placement has missing or unknown assignments.');
    }
}
function assertOwnerPlacement(
    plan: PlacementPlan,
    placement: PlacementPlan['resourceOwnership']['owners'][number]['placement']
): void {
    if (
        placement.kind === 'executor-lane' && plan.lanes.every(function missing(lane) {
            return lane.id !== placement.lane;
        })
    ) {
        throw new TypeError('Replay resource owner refers to an unknown lane.');
    }
    if (
        placement.kind === 'work-unit' && plan.units.every(function missing(unit) {
            return traceUnitKey(unit.id) !== traceUnitKey(placement.unit);
        })
    ) {
        throw new TypeError('Replay resource owner refers to an unknown unit.');
    }
}
function assertOwnership(plan: PlacementPlan, identities: ReadonlySet<string>): void {
    for (const owner of plan.resourceOwnership.owners) {
        if (
            owner.work.some(function unknown(work) {
                return !identities.has(workIdentityKey(work));
            })
        ) {
            throw new TypeError('Replay resource owner refers to unknown work.');
        }
        assertOwnerPlacement(plan, owner.placement);
    }
}
export function validateReplayPlacement(plan: PlacementPlan, identities: readonly WorkId[]): void {
    assertUnique(plan.units.map(function key(unit) {
        return traceUnitKey(unit.id);
    }));
    assertUnique(plan.lanes.map(function key(lane) {
        return lane.id;
    }));
    const work = plan.units.flatMap(function members(unit) {
        return unit.work.map(workIdentityKey);
    });
    assertUnique(work);
    const expected = new Set(identities.map(workIdentityKey));
    if (
        work.length !== expected.size || work.some(function unrelated(key) {
            return !expected.has(key);
        })
    ) {
        throw new TypeError('Replay placement does not cover the recorded work.');
    }
    assertAssignments(plan);
    assertOwnership(plan, expected);
}
