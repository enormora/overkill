import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createCaseId, caseIdentityKey } from '../engine/identity.ts';
import {
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import { orderedRunItems } from './run-selection.ts';
import type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    PlacementAssignment,
    PlacementLane,
    PlacementPlan,
    RunOrder,
    RunSeed,
    WorkId,
    WorkUnit,
    WorkUnitId
} from './run-types.ts';

const maximumWorkerCount = 8;

export type WorkerPoolPlacementPlanInput = {
    readonly availableParallelism: number;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
};

function suiteTitles(suitePath: CollectedRunCase['suitePath']): readonly string[] {
    return suitePath.map(function toTitle(entry) {
        return entry.title;
    });
}

function workId(file: string, testCase: CollectedRunCase): WorkId {
    return {
        case: createCaseId(file, suiteTitles(testCase.suitePath), testCase.title, testCase.params),
        runtime: null,
        workload: null
    };
}

function workUnitId(file: string): WorkUnitId {
    return {
        key: file,
        mode: 'file',
        runtime: null,
        workload: null
    };
}

function nonEmptyWork(file: CollectedRunFile): NonEmptyReadonlyArray<WorkId> | null {
    const work = file.cases.map(function toWork(testCase) {
        return workId(file.file, testCase);
    });
    const firstWork = work[0];

    return firstWork === undefined ? null : [ firstWork, ...work.slice(1) ];
}

function workUnit(file: CollectedRunFile): WorkUnit | null {
    const work = nonEmptyWork(file);

    return work === null
        ? null
        : {
            group: null,
            id: workUnitId(file.file),
            work
        };
}

export function workUnitsFromCollectedPlan(plan: CollectedRunPlan): readonly WorkUnit[] {
    return plan.files.flatMap(function toWorkUnit(file) {
        const unit = workUnit(file);

        return unit === null ? [] : [ unit ];
    });
}

function defaultWorkerCount(availableParallelism: number, unitCount: number): number {
    if (unitCount === 0) {
        return 0;
    }

    return Math.min(Math.max(availableParallelism - 1, 1), maximumWorkerCount, unitCount);
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

function placementLanes(workerCount: number): readonly PlacementLane[] {
    return Array.from({ length: workerCount }, function toLane(_value, index) {
        return placementLane(index);
    });
}

function assignedLane(lanes: readonly PlacementLane[], unitIndex: number): PlacementLane {
    const lane = lanes[unitIndex % lanes.length];

    if (lane === undefined) {
        throw new Error('Worker-pool placement requires at least one lane.');
    }

    return lane;
}

function placementAssignments(
    units: readonly WorkUnit[],
    lanes: readonly PlacementLane[]
): readonly PlacementAssignment[] {
    return units.map(function toAssignment(unit, index) {
        return {
            lane: assignedLane(lanes, index).id,
            unit: unit.id
        };
    });
}

export function createWorkerPoolPlacementPlan(input: WorkerPoolPlacementPlanInput): PlacementPlan {
    const units = orderedRunItems(workUnitsFromCollectedPlan(input.selectedPlan), input.order, input.seed);
    const lanes = placementLanes(defaultWorkerCount(input.availableParallelism, units.length));

    return {
        assignments: placementAssignments(units, lanes),
        lanes,
        units
    };
}

function collectedEntriesByCaseKey(
    collectedPlan: CollectedRunPlan
): ReadonlyMap<string, ReturnType<typeof collectedRunCaseEntries>[number]> {
    return new Map(
        collectedRunCaseEntries(collectedPlan).map(function toEntry(entry) {
            return [ caseIdentityKey(entry.id), entry ];
        })
    );
}

export function collectedRunCaseEntriesFromWorkUnits(
    collectedPlan: CollectedRunPlan,
    units: readonly WorkUnit[]
): ReturnType<typeof collectedRunCaseEntries> {
    const entries = collectedEntriesByCaseKey(collectedPlan);

    return units.flatMap(function toRunCaseEntries(unit) {
        return unit.work.map(function toRunCaseEntry(work) {
            const entry = entries.get(caseIdentityKey(work.case));

            if (entry === undefined) {
                throw new Error('Placement plan referenced an unknown collected case.');
            }

            return entry;
        });
    });
}
