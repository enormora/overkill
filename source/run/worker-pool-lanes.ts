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

export function workerPoolPlacementAssignments(
    units: readonly WorkUnit[],
    lanes: readonly PlacementLane[]
): readonly PlacementAssignment[] {
    const lifecycleLanes = lanesByLifecycle(lanes, units);
    const lifecycleIndexes = new Map<RunWorkerLifecycle, number>();

    return units.map(function toAssignment(unit) {
        const lanesForUnit = lifecycleLanes.get(unit.workerLifecycle) ?? [];
        const nextIndex = lifecycleIndexes.get(unit.workerLifecycle) ?? 0;

        lifecycleIndexes.set(unit.workerLifecycle, nextIndex + 1);

        return {
            lane: assignedLane(lanesForUnit, nextIndex).id,
            unit: unit.id
        };
    });
}
