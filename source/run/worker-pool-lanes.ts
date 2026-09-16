import { invalidRequest } from './run-errors.ts';
import type {
    PlacementAssignment,
    PlacementLane,
    RunWorkerLifecycle,
    WorkUnit
} from './run-types.ts';

const maximumWorkerCount = 8;
const mixedLifecycleCount = 2;
const freshWorkerLifecycle = 'fresh-worker-per-unit';
const reuseWorkerLifecycle = 'reuse';
const workerLifecycles: readonly RunWorkerLifecycle[] = [ reuseWorkerLifecycle, freshWorkerLifecycle ];

export type WorkerPoolLaneInput = {
    readonly availableParallelism: number;
    readonly units: readonly WorkUnit[];
};

type LifecycleLaneCounts = {
    readonly freshLanes: number;
    readonly remainingLanes: number;
    readonly reuseLanes: number;
};
type LanePlacementState = {
    readonly chooseLane: (unit: WorkUnit, lanes: readonly PlacementLane[]) => PlacementLane;
    readonly firstFixedLane: (unit: WorkUnit, lanes: readonly PlacementLane[]) => PlacementLane | null;
    readonly rememberLaneChoice: (unit: WorkUnit, lane: PlacementLane) => void;
};
type LaneChoiceSnapshot = {
    readonly faultDomainLanes: ReadonlyMap<string, ReadonlySet<string>>;
    readonly laneLoads: ReadonlyMap<string, number>;
    readonly preferredLaneByAffinity: ReadonlyMap<string, string>;
};

function defaultWorkerCount(availableParallelism: number, unitCount: number): number {
    if (!Number.isSafeInteger(availableParallelism) || availableParallelism <= 0) {
        invalidRequest('Available parallelism must be a positive safe integer.');
    }

    if (unitCount === 0) {
        return 0;
    }

    return Math.min(Math.max(availableParallelism - 1, 1), maximumWorkerCount, unitCount);
}

function lifecycleCount(units: readonly WorkUnit[], workerLifecycle: RunWorkerLifecycle): number {
    return units
        .filter(function hasWorkerLifecycle(unit) {
            return unit.workerLifecycle === workerLifecycle;
        })
        .length;
}

function hasMixedLifecycles(units: readonly WorkUnit[]): boolean {
    return lifecycleCount(units, freshWorkerLifecycle) > 0 &&
        lifecycleCount(units, reuseWorkerLifecycle) > 0;
}

function firstUnitWorkerLifecycle(units: readonly WorkUnit[]): RunWorkerLifecycle {
    return units.reduce<RunWorkerLifecycle>(function keepFirstLifecycle(firstLifecycle, unit, index) {
        return index === 0 ? unit.workerLifecycle : firstLifecycle;
    }, reuseWorkerLifecycle);
}

function workerCount(input: WorkerPoolLaneInput): number {
    const baseWorkerCount = defaultWorkerCount(input.availableParallelism, input.units.length);

    return hasMixedLifecycles(input.units)
        ? Math.max(baseWorkerCount, mixedLifecycleCount)
        : baseWorkerCount;
}

function placementLane(index: number): PlacementLane {
    const id = `worker-${index + 1}`;

    return {
        executor: {
            capabilities: [],
            capacity: 1,
            id,
            kind: 'local-worker'
        },
        id
    };
}

export function workerPoolLanes(input: WorkerPoolLaneInput): readonly PlacementLane[] {
    return Array.from({ length: workerCount(input) }, function toLane(_value, index) {
        return placementLane(index);
    });
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

function lifecycleLaneCounts(
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

function lanesByLifecycle(
    lanes: readonly PlacementLane[],
    units: readonly WorkUnit[]
): ReadonlyMap<RunWorkerLifecycle, readonly PlacementLane[]> {
    const counts = lifecycleLaneCounts(units, lanes.length);
    let nextLaneIndex = 0;

    return new Map(
        workerLifecycles.map(function toLifecycleLanes(workerLifecycle) {
            const laneCount = counts.get(workerLifecycle) ?? 0;
            const lifecycleLanes = lanes.slice(nextLaneIndex, nextLaneIndex + laneCount);

            nextLaneIndex += laneCount;

            return [ workerLifecycle, lifecycleLanes ];
        })
    );
}

function assignedLane(lanes: readonly PlacementLane[], unitIndex: number): PlacementLane {
    const lane = lanes[unitIndex % lanes.length];

    if (lane === undefined) {
        throw new Error('Worker-pool placement requires at least one lane.');
    }

    return lane;
}

function laneById(lanes: readonly PlacementLane[], laneId: string): PlacementLane | null {
    return lanes.find(function hasId(lane) {
        return lane.id === laneId;
    }) ?? null;
}

function firstFixedLane(
    unit: WorkUnit,
    lanes: readonly PlacementLane[],
    fixedLaneByKey: ReadonlyMap<string, string>
): PlacementLane | null {
    const fixedLane = [ ...unit.resourceConstraints.singleWorkerKeys, ...unit.resourceConstraints.serialKeys ]
        .map(function toFixedLane(key) {
            return fixedLaneByKey.get(key) ?? null;
        })
        .find(function hasLaneId(laneId) {
            return laneId !== null;
        });

    return fixedLane === undefined ? null : laneById(lanes, fixedLane);
}

function affinityScore(
    unit: WorkUnit,
    lane: PlacementLane,
    preferredLaneByAffinity: ReadonlyMap<string, string>
): number {
    return unit
        .resourceConstraints
        .affinityKeys
        .filter(function hasAffinity(key) {
            return preferredLaneByAffinity.get(key) === lane.id;
        })
        .length;
}

function faultDomainScore(
    unit: WorkUnit,
    lane: PlacementLane,
    faultDomainLanes: ReadonlyMap<string, ReadonlySet<string>>
): number {
    return unit
        .resourceConstraints
        .faultDomains
        .filter(function hasFaultDomain(key) {
            return faultDomainLanes.get(key)?.has(lane.id) ?? false;
        })
        .length;
}

function laneLoad(lane: PlacementLane, laneLoads: ReadonlyMap<string, number>): number {
    return laneLoads.get(lane.id) ?? 0;
}

function chooseLane(
    unit: WorkUnit,
    lanes: readonly PlacementLane[],
    state: LaneChoiceSnapshot
): PlacementLane {
    const orderedLanes = lanes.toSorted(function compareLanes(left, right) {
        const affinityDifference = affinityScore(unit, right, state.preferredLaneByAffinity) -
            affinityScore(unit, left, state.preferredLaneByAffinity);

        if (affinityDifference !== 0) {
            return affinityDifference;
        }

        const faultDifference = faultDomainScore(unit, left, state.faultDomainLanes) -
            faultDomainScore(unit, right, state.faultDomainLanes);

        if (faultDifference !== 0) {
            return faultDifference;
        }

        const loadDifference = laneLoad(left, state.laneLoads) - laneLoad(right, state.laneLoads);

        return loadDifference === 0 ? left.id.localeCompare(right.id) : loadDifference;
    });
    const lane = orderedLanes[0];

    if (lane === undefined) {
        throw new Error('Worker-pool placement requires at least one lane.');
    }

    return lane;
}

function createLanePlacementState(): LanePlacementState {
    const faultDomainLanes = new Map<string, Set<string>>();
    const fixedLaneByKey = new Map<string, string>();
    const laneLoads = new Map<string, number>();
    const preferredLaneByAffinity = new Map<string, string>();

    function rememberLaneChoice(unit: WorkUnit, lane: PlacementLane): void {
        laneLoads.set(lane.id, laneLoad(lane, laneLoads) + unit.resourceConstraints.capacityWeight);

        for (const key of [ ...unit.resourceConstraints.singleWorkerKeys, ...unit.resourceConstraints.serialKeys ]) {
            fixedLaneByKey.set(key, lane.id);
        }

        for (const key of unit.resourceConstraints.affinityKeys) {
            if (!preferredLaneByAffinity.has(key)) {
                preferredLaneByAffinity.set(key, lane.id);
            }
        }

        for (const key of unit.resourceConstraints.faultDomains) {
            const lanesForDomain = faultDomainLanes.get(key) ?? new Set<string>();

            lanesForDomain.add(lane.id);
            faultDomainLanes.set(key, lanesForDomain);
        }
    }

    return {
        chooseLane(unit, lanes) {
            return chooseLane(unit, lanes, {
                faultDomainLanes,
                laneLoads,
                preferredLaneByAffinity
            });
        },
        firstFixedLane(unit, lanes) {
            return firstFixedLane(unit, lanes, fixedLaneByKey);
        },
        rememberLaneChoice(unit, lane) {
            rememberLaneChoice(unit, lane);
        }
    };
}

function requiresResourceAwareLane(unit: WorkUnit): boolean {
    return unit.resourceConstraints.affinityKeys.length > 0 ||
        unit.resourceConstraints.capacityWeight !== 1 ||
        unit.resourceConstraints.faultDomains.length > 0;
}

function selectedLaneForUnit(
    unit: WorkUnit,
    lanes: readonly PlacementLane[],
    nextIndex: number,
    placementState: LanePlacementState
): PlacementLane {
    const fixedLane = placementState.firstFixedLane(unit, lanes);

    if (fixedLane !== null) {
        return fixedLane;
    }

    return requiresResourceAwareLane(unit)
        ? placementState.chooseLane(unit, lanes)
        : assignedLane(lanes, nextIndex);
}

export function workerPoolPlacementAssignments(
    units: readonly WorkUnit[],
    lanes: readonly PlacementLane[]
): readonly PlacementAssignment[] {
    const lifecycleLanes = lanesByLifecycle(lanes, units);
    const lifecycleIndexes = new Map<RunWorkerLifecycle, number>();
    const placementState = createLanePlacementState();

    return units.map(function toAssignment(unit) {
        const lanesForUnit = lifecycleLanes.get(unit.workerLifecycle) ?? [];
        const nextIndex = lifecycleIndexes.get(unit.workerLifecycle) ?? 0;
        const lane = selectedLaneForUnit(unit, lanesForUnit, nextIndex, placementState);

        lifecycleIndexes.set(unit.workerLifecycle, nextIndex + 1);
        placementState.rememberLaneChoice(unit, lane);

        return {
            lane: lane.id,
            unit: unit.id
        };
    });
}
