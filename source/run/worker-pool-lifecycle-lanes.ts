import {
    emptyWorkUnitResourceConstraints,
    type RunWorkerLifecycle,
    type RunWorkerPoolAssignmentPolicy,
    type WorkUnit
} from './run-types.ts';

const mixedLifecycleCount = 2;

export const freshWorkerLifecycle = 'fresh-worker-per-unit';
export const reuseWorkerLifecycle = 'reuse';
export const workerLifecycles: readonly RunWorkerLifecycle[] = [ reuseWorkerLifecycle, freshWorkerLifecycle ];

type LifecycleLaneCounts = {
    readonly freshLanes: number;
    readonly remainingLanes: number;
    readonly reuseLanes: number;
};
type LifecycleLaneAllocation = {
    readonly freshLoad: number;
    readonly freshUnitCount: number;
    readonly reuseLoad: number;
    readonly reuseUnitCount: number;
    readonly tiedLifecycle: RunWorkerLifecycle;
};
type AssignedLifecycleLanes = {
    readonly freshLaneCount: number;
    readonly reuseLaneCount: number;
};
type UnitLoad = (unit: WorkUnit) => number;

export function lifecycleCount(units: readonly WorkUnit[], workerLifecycle: RunWorkerLifecycle): number {
    return units
        .filter(function hasWorkerLifecycle(unit) {
            return unit.workerLifecycle === workerLifecycle;
        })
        .length;
}

function selectedCaseCount(unit: WorkUnit): number {
    return unit.work.length;
}

export function caseCountPlacementLoad(unit: WorkUnit): number {
    return selectedCaseCount(unit) +
        unit.resourceConstraints.capacityWeight -
        emptyWorkUnitResourceConstraints.capacityWeight;
}

function lifecycleLoad(
    units: readonly WorkUnit[],
    workerLifecycle: RunWorkerLifecycle,
    unitLoad: UnitLoad
): number {
    return units
        .filter(function hasWorkerLifecycle(unit) {
            return unit.workerLifecycle === workerLifecycle;
        })
        .reduce(function sumUnitLoad(total, unit) {
            return total + unitLoad(unit);
        }, 0);
}

function firstUnitWorkerLifecycle(units: readonly WorkUnit[]): RunWorkerLifecycle {
    return units.reduce<RunWorkerLifecycle>(function keepFirstLifecycle(firstLifecycle, unit, index) {
        return index === 0 ? unit.workerLifecycle : firstLifecycle;
    }, reuseWorkerLifecycle);
}

function proportionalExtraLaneLifecycle(
    units: readonly WorkUnit[],
    remainingLanes: number,
    tiedLifecycle: RunWorkerLifecycle
): RunWorkerLifecycle {
    const freshUnits = lifecycleCount(units, freshWorkerLifecycle);
    const reuseUnits = lifecycleCount(units, reuseWorkerLifecycle);
    const totalUnits = freshUnits + reuseUnits;
    const freshRemainder = remainingLanes * freshUnits / totalUnits % 1;
    const reuseRemainder = remainingLanes * reuseUnits / totalUnits % 1;

    if (freshRemainder !== reuseRemainder) {
        return freshRemainder > reuseRemainder ? freshWorkerLifecycle : reuseWorkerLifecycle;
    }

    return tiedLifecycle;
}

function mixedLifecycleBaseLaneCounts(
    units: readonly WorkUnit[],
    totalLaneCount: number
): LifecycleLaneCounts {
    const freshUnits = lifecycleCount(units, freshWorkerLifecycle);
    const reuseUnits = lifecycleCount(units, reuseWorkerLifecycle);
    const remainingLanes = totalLaneCount - mixedLifecycleCount;
    const unitCount = freshUnits + reuseUnits;

    return {
        freshLanes: 1 + Math.floor(remainingLanes * freshUnits / unitCount),
        remainingLanes,
        reuseLanes: 1 + Math.floor(remainingLanes * reuseUnits / unitCount)
    };
}

function mixedLifecycleLaneCounts(
    units: readonly WorkUnit[],
    totalLaneCount: number
): ReadonlyMap<RunWorkerLifecycle, number> {
    let { freshLanes, remainingLanes, reuseLanes } = mixedLifecycleBaseLaneCounts(units, totalLaneCount);

    if (freshLanes + reuseLanes < totalLaneCount) {
        const targetLifecycle = proportionalExtraLaneLifecycle(units, remainingLanes, firstUnitWorkerLifecycle(units));

        if (targetLifecycle === freshWorkerLifecycle) {
            freshLanes += 1;
        } else {
            reuseLanes += 1;
        }
    }

    return new Map([
        [ freshWorkerLifecycle, freshLanes ],
        [ reuseWorkerLifecycle, reuseLanes ]
    ]);
}

function stableLifecycleLaneCounts(
    units: readonly WorkUnit[],
    totalLaneCount: number
): ReadonlyMap<RunWorkerLifecycle, number> {
    if (lifecycleCount(units, freshWorkerLifecycle) === 0) {
        return new Map([ [ reuseWorkerLifecycle, totalLaneCount ] ]);
    }

    if (lifecycleCount(units, reuseWorkerLifecycle) === 0) {
        return new Map([ [ freshWorkerLifecycle, totalLaneCount ] ]);
    }

    return mixedLifecycleLaneCounts(units, totalLaneCount);
}

function balancedLifecycleLaneAllocation(
    units: readonly WorkUnit[],
    freshUnits: number,
    reuseUnits: number,
    unitLoad: UnitLoad
): LifecycleLaneAllocation {
    return {
        freshLoad: lifecycleLoad(units, freshWorkerLifecycle, unitLoad),
        freshUnitCount: freshUnits,
        reuseLoad: lifecycleLoad(units, reuseWorkerLifecycle, unitLoad),
        reuseUnitCount: reuseUnits,
        tiedLifecycle: firstUnitWorkerLifecycle(units)
    };
}

function initialLifecycleLanes(): AssignedLifecycleLanes {
    return {
        freshLaneCount: 1,
        reuseLaneCount: 1
    };
}

function lifecycleLaneCount(lanes: AssignedLifecycleLanes, workerLifecycle: RunWorkerLifecycle): number {
    return workerLifecycle === freshWorkerLifecycle ? lanes.freshLaneCount : lanes.reuseLaneCount;
}

function lifecycleUnitCount(allocation: LifecycleLaneAllocation, workerLifecycle: RunWorkerLifecycle): number {
    return workerLifecycle === freshWorkerLifecycle ? allocation.freshUnitCount : allocation.reuseUnitCount;
}

function lifecyclePlacementLoad(allocation: LifecycleLaneAllocation, workerLifecycle: RunWorkerLifecycle): number {
    return workerLifecycle === freshWorkerLifecycle ? allocation.freshLoad : allocation.reuseLoad;
}

function assignedLifecycleLaneCount(lanes: AssignedLifecycleLanes): number {
    return lanes.freshLaneCount + lanes.reuseLaneCount;
}

function lifecycleHasUnitCapacity(
    allocation: LifecycleLaneAllocation,
    lanes: AssignedLifecycleLanes,
    workerLifecycle: RunWorkerLifecycle
): boolean {
    return lifecycleLaneCount(lanes, workerLifecycle) < lifecycleUnitCount(allocation, workerLifecycle);
}

function lifecycleAverageLoad(
    allocation: LifecycleLaneAllocation,
    lanes: AssignedLifecycleLanes,
    workerLifecycle: RunWorkerLifecycle
): number {
    return lifecyclePlacementLoad(allocation, workerLifecycle) / lifecycleLaneCount(lanes, workerLifecycle);
}

function compareTiedLifecycle(
    allocation: LifecycleLaneAllocation,
    left: RunWorkerLifecycle
): number {
    return left === allocation.tiedLifecycle ? -1 : 1;
}

function compareLifecycleCandidate(
    allocation: LifecycleLaneAllocation,
    lanes: AssignedLifecycleLanes,
    left: RunWorkerLifecycle,
    right: RunWorkerLifecycle
): number {
    const loadDifference = lifecycleAverageLoad(allocation, lanes, right) -
        lifecycleAverageLoad(allocation, lanes, left);

    return loadDifference === 0 ? compareTiedLifecycle(allocation, left) : loadDifference;
}

function nextLifecycleWithCapacity(
    allocation: LifecycleLaneAllocation,
    lanes: AssignedLifecycleLanes
): RunWorkerLifecycle | null {
    return workerLifecycles
        .filter(function hasUnitCapacity(workerLifecycle) {
            return lifecycleHasUnitCapacity(allocation, lanes, workerLifecycle);
        })
        .toSorted(function compareLifecycleLoad(left, right) {
            return compareLifecycleCandidate(allocation, lanes, left, right);
        })[0] ?? null;
}

function lifecycleWithAdditionalLane(
    lanes: AssignedLifecycleLanes,
    workerLifecycle: RunWorkerLifecycle
): AssignedLifecycleLanes {
    return workerLifecycle === freshWorkerLifecycle
        ? { ...lanes, freshLaneCount: lanes.freshLaneCount + 1 }
        : { ...lanes, reuseLaneCount: lanes.reuseLaneCount + 1 };
}

function allocateCaseCountBalancedLifecycleLanes(
    allocation: LifecycleLaneAllocation,
    totalLaneCount: number
): AssignedLifecycleLanes {
    let lanes = initialLifecycleLanes();

    while (assignedLifecycleLaneCount(lanes) < totalLaneCount) {
        const target = nextLifecycleWithCapacity(allocation, lanes);

        if (target === null) {
            return lanes;
        }

        lanes = lifecycleWithAdditionalLane(lanes, target);
    }

    return lanes;
}

function balancedLifecycleLaneCounts(
    units: readonly WorkUnit[],
    totalLaneCount: number,
    unitLoad: UnitLoad
): ReadonlyMap<RunWorkerLifecycle, number> {
    const freshUnits = lifecycleCount(units, freshWorkerLifecycle);
    const reuseUnits = lifecycleCount(units, reuseWorkerLifecycle);

    if (freshUnits === 0) {
        return new Map([ [ reuseWorkerLifecycle, totalLaneCount ] ]);
    }

    if (reuseUnits === 0) {
        return new Map([ [ freshWorkerLifecycle, totalLaneCount ] ]);
    }

    const allocation = balancedLifecycleLaneAllocation(units, freshUnits, reuseUnits, unitLoad);
    const lanes = allocateCaseCountBalancedLifecycleLanes(allocation, totalLaneCount);

    return new Map([
        [ freshWorkerLifecycle, lanes.freshLaneCount ],
        [ reuseWorkerLifecycle, lanes.reuseLaneCount ]
    ]);
}

export function lifecycleLaneCounts(
    units: readonly WorkUnit[],
    totalLaneCount: number,
    assignmentPolicy: RunWorkerPoolAssignmentPolicy,
    unitLoad: UnitLoad | null
): ReadonlyMap<RunWorkerLifecycle, number> {
    return assignmentPolicy === 'case-count-balanced' || unitLoad !== null
        ? balancedLifecycleLaneCounts(units, totalLaneCount, unitLoad ?? caseCountPlacementLoad)
        : stableLifecycleLaneCounts(units, totalLaneCount);
}
