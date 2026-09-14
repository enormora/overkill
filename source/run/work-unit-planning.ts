import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createCaseId, caseIdentityKey } from '../engine/identity.ts';
import {
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import { invalidRequest } from './run-errors.ts';
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
    RunWorkDistribution,
    RunWorkGroup,
    WorkId,
    WorkUnit,
    WorkUnitId
} from './run-types.ts';

const maximumWorkerCount = 8;

export type WorkerPoolPlacementPlanInput = {
    readonly availableParallelism: number;
    readonly fileSetForFile: (file: string) => string | null;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
    readonly workDistribution: RunWorkDistribution;
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

function fileWorkUnitId(file: string): WorkUnitId {
    return {
        key: file,
        mode: 'file',
        runtime: null,
        workload: null
    };
}

function caseWorkUnitId(work: WorkId): WorkUnitId {
    return {
        key: caseIdentityKey(work.case),
        mode: 'case',
        runtime: work.runtime,
        workload: work.workload
    };
}

function groupWorkUnitId(group: RunWorkGroup): WorkUnitId {
    return {
        key: group.name,
        mode: 'group',
        runtime: null,
        workload: null
    };
}

function workFromCases(file: CollectedRunFile): readonly WorkId[] {
    return file.cases.map(function toWork(testCase) {
        return workId(file.file, testCase);
    });
}

function nonEmptyWork(work: readonly WorkId[]): NonEmptyReadonlyArray<WorkId> | null {
    const firstWork = work[0];

    return firstWork === undefined ? null : [ firstWork, ...work.slice(1) ];
}

function fileWorkUnit(file: CollectedRunFile): WorkUnit | null {
    const work = nonEmptyWork(workFromCases(file));

    return work === null
        ? null
        : {
            group: null,
            id: fileWorkUnitId(file.file),
            work
        };
}

function caseWorkUnit(work: WorkId): WorkUnit {
    return {
        group: null,
        id: caseWorkUnitId(work),
        work: [ work ]
    };
}

function fileWorkUnitsFromCollectedPlan(plan: CollectedRunPlan): readonly WorkUnit[] {
    return plan.files.flatMap(function toWorkUnit(file) {
        const unit = fileWorkUnit(file);

        return unit === null ? [] : [ unit ];
    });
}

function caseWorkUnitsFromCollectedPlan(plan: CollectedRunPlan): readonly WorkUnit[] {
    return plan.files.flatMap(function toWorkUnits(file) {
        return workFromCases(file).map(caseWorkUnit);
    });
}

function filesWithCases(plan: CollectedRunPlan): readonly CollectedRunFile[] {
    return plan.files.filter(function hasCollectedCases(file) {
        return file.cases.length > 0;
    });
}

function selectedFileSets(
    plan: CollectedRunPlan,
    fileSetForFile: (file: string) => string | null
): ReadonlyMap<string, string> {
    const fileSets = new Map<string, string>();

    for (const file of filesWithCases(plan)) {
        const fileSet = fileSetForFile(file.file);

        if (fileSet === null) {
            invalidRequest(`Grouped work distribution requires a file set for "${file.file}".`);
        }

        fileSets.set(file.file, fileSet);
    }

    return fileSets;
}

function assignedGroupFileSets(distribution: RunWorkDistribution): ReadonlySet<string> {
    if (distribution.mode !== 'group') {
        return new Set();
    }

    return new Set(distribution.groups.flatMap(function toFileSets(group) {
        return group.fileSets;
    }));
}

function assertNoUnmatchedSelectedFileSets(
    plan: CollectedRunPlan,
    distribution: RunWorkDistribution,
    fileSetForFile: (file: string) => string | null
): ReadonlyMap<string, string> {
    const fileSets = selectedFileSets(plan, fileSetForFile);
    const assignedFileSets = assignedGroupFileSets(distribution);

    for (const [ file, fileSet ] of fileSets) {
        if (!assignedFileSets.has(fileSet)) {
            invalidRequest(`Grouped work distribution has no group for file set "${fileSet}" selected by "${file}".`);
        }
    }

    return fileSets;
}

function groupedFiles(
    plan: CollectedRunPlan,
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>
): readonly CollectedRunFile[] {
    const groupFileSets = new Set(group.fileSets);

    return plan.files.filter(function fileBelongsToGroup(file) {
        const fileSet = fileSets.get(file.file);

        return fileSet !== undefined && groupFileSets.has(fileSet);
    });
}

function groupWorkUnit(
    plan: CollectedRunPlan,
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>
): WorkUnit | null {
    const work = nonEmptyWork(groupedFiles(plan, group, fileSets).flatMap(workFromCases));

    return work === null
        ? null
        : {
            group: group.name,
            id: groupWorkUnitId(group),
            work
        };
}

function groupWorkUnitsFromCollectedPlan(
    plan: CollectedRunPlan,
    distribution: RunWorkDistribution,
    fileSetForFile: (file: string) => string | null
): readonly WorkUnit[] {
    if (distribution.mode !== 'group') {
        return [];
    }

    const fileSets = assertNoUnmatchedSelectedFileSets(plan, distribution, fileSetForFile);

    return distribution.groups.flatMap(function toGroupUnit(group) {
        const unit = groupWorkUnit(plan, group, fileSets);

        return unit === null ? [] : [ unit ];
    });
}

export function workUnitsFromCollectedPlan(
    plan: CollectedRunPlan,
    distribution: RunWorkDistribution = { mode: 'file' },
    fileSetForFile: (file: string) => string | null = function noFileSet() {
        return null;
    }
): readonly WorkUnit[] {
    if (distribution.mode === 'case') {
        return caseWorkUnitsFromCollectedPlan(plan);
    }

    if (distribution.mode === 'group') {
        return groupWorkUnitsFromCollectedPlan(plan, distribution, fileSetForFile);
    }

    return fileWorkUnitsFromCollectedPlan(plan);
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
    const units = orderedRunItems(
        workUnitsFromCollectedPlan(input.selectedPlan, input.workDistribution, input.fileSetForFile),
        input.order,
        input.seed
    );
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
