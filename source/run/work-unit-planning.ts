import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createCaseId, caseIdentityKey } from '../engine/identity.ts';
import {
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import { invalidRequest } from './run-errors.ts';
import { orderedRunItems } from './run-selection.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunCase,
    type CollectedRunFile,
    type CollectedRunPlan,
    type PlacementPlan,
    type RunOrder,
    type RunSeed,
    type RunScheduling,
    type RunWorkDistribution,
    type RunWorkGroup,
    type RunWorkerPoolAssignmentPolicy,
    type RunWorkerLifecycle,
    type WorkId,
    type WorkUnit,
    type WorkUnitId
} from './run-types.ts';
import { workResourceConstraints } from './work-unit-resource-constraints.ts';
import {
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

type GroupWorkDistribution = Extract<RunWorkDistribution, { readonly mode: 'group'; }>;

export type WorkerPoolPlacementPlanInput = {
    readonly assignmentPolicy: RunWorkerPoolAssignmentPolicy;
    readonly availableParallelism: number;
    readonly fileSetForFile: (file: string) => string | null;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
    readonly scheduling: RunScheduling;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type WorkUnitPlanningInput = {
    readonly fileSetForFile: (file: string) => string | null;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
    readonly scheduling: RunScheduling;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

type WorkUnitPolicy = {
    readonly order: RunOrder;
    readonly scheduling: RunScheduling;
    readonly workerLifecycle: RunWorkerLifecycle;
};

type PlannedWorkUnit = {
    readonly bucket: string | null;
    readonly order: RunOrder;
    readonly position: number;
    readonly unit: WorkUnit;
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

function profilePolicy(input: WorkUnitPlanningInput): WorkUnitPolicy {
    return {
        order: input.order,
        scheduling: input.scheduling,
        workerLifecycle: input.workerLifecycle
    };
}

function groupOrder(group: RunWorkGroup, input: WorkUnitPlanningInput): RunOrder {
    if (group.order === 'profile-default') {
        return input.order;
    }

    return group.order;
}

function groupScheduling(group: RunWorkGroup, input: WorkUnitPlanningInput): RunScheduling {
    if (group.scheduling === 'profile-default') {
        return input.scheduling;
    }

    return group.scheduling;
}

function groupWorkerLifecycle(group: RunWorkGroup, input: WorkUnitPlanningInput): RunWorkerLifecycle {
    if (group.workerLifecycle === 'profile-default') {
        return input.workerLifecycle;
    }

    return group.workerLifecycle;
}

function groupPolicy(group: RunWorkGroup, input: WorkUnitPlanningInput): WorkUnitPolicy {
    return {
        order: groupOrder(group, input),
        scheduling: groupScheduling(group, input),
        workerLifecycle: groupWorkerLifecycle(group, input)
    };
}

function workFromCases(file: CollectedRunFile): readonly WorkId[] {
    return file.cases.map(function toWork(testCase) {
        return workId(file.file, testCase);
    });
}

function orderedNonEmptyWork(
    work: readonly WorkId[],
    policy: WorkUnitPolicy,
    seed: RunSeed
): NonEmptyReadonlyArray<WorkId> | null {
    const orderedWork = orderedRunItems(work, policy.order, seed);
    const firstWork = orderedWork[0];

    return firstWork === undefined ? null : [ firstWork, ...orderedWork.slice(1) ];
}

function fileWorkUnit(
    file: CollectedRunFile,
    policy: WorkUnitPolicy,
    group: string | null,
    seed: RunSeed
): WorkUnit | null {
    const work = orderedNonEmptyWork(workFromCases(file), policy, seed);

    return work === null
        ? null
        : {
            group,
            id: fileWorkUnitId(file.file),
            order: policy.order,
            resourceConstraints: emptyWorkUnitResourceConstraints,
            scheduling: policy.scheduling,
            workerLifecycle: policy.workerLifecycle,
            work
        };
}

function caseWorkUnit(work: WorkId, policy: WorkUnitPolicy, group: string | null): WorkUnit {
    return {
        group,
        id: caseWorkUnitId(work),
        order: policy.order,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        scheduling: policy.scheduling,
        work: [ work ],
        workerLifecycle: policy.workerLifecycle
    };
}

function workUnitWithResourceConstraints(unit: WorkUnit, plan: CollectedRunPlan): WorkUnit {
    return {
        ...unit,
        resourceConstraints: workResourceConstraints(unit.work, plan)
    };
}

function workUnitsWithResourceConstraints(units: readonly WorkUnit[], plan: CollectedRunPlan): readonly WorkUnit[] {
    return units.map(function withResourceConstraints(unit) {
        return workUnitWithResourceConstraints(unit, plan);
    });
}

function fileWorkUnitsFromCollectedPlan(input: WorkUnitPlanningInput): readonly WorkUnit[] {
    const policy = profilePolicy(input);

    return orderedRunItems(
        input.selectedPlan.files.flatMap(function toWorkUnit(file) {
            const unit = fileWorkUnit(file, policy, null, input.seed);

            return unit === null ? [] : [ unit ];
        }),
        input.order,
        input.seed
    );
}

function caseWorkUnitsFromCollectedPlan(input: WorkUnitPlanningInput): readonly WorkUnit[] {
    const policy = profilePolicy(input);

    return orderedRunItems(
        input.selectedPlan.files.flatMap(function toWorkUnits(file) {
            return workFromCases(file).map(function toCaseWorkUnit(work) {
                return caseWorkUnit(work, policy, null);
            });
        }),
        input.order,
        input.seed
    );
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

function assignedGroupFileSets(distribution: GroupWorkDistribution): ReadonlySet<string> {
    return new Set(distribution.groups.flatMap(function toFileSets(group) {
        return group.fileSets;
    }));
}

function assertNoUnmatchedSelectedFileSets(
    plan: CollectedRunPlan,
    distribution: GroupWorkDistribution,
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

function selectedGroupName(
    distribution: GroupWorkDistribution,
    fileSet: string
): string | null {
    for (const group of distribution.groups) {
        if (group.fileSets.includes(fileSet)) {
            return group.name;
        }
    }

    return null;
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
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>,
    policy: WorkUnitPolicy,
    input: WorkUnitPlanningInput
): WorkUnit | null {
    const work = orderedNonEmptyWork(
        groupedFiles(input.selectedPlan, group, fileSets).flatMap(workFromCases),
        policy,
        input.seed
    );

    return work === null
        ? null
        : {
            group: group.name,
            id: groupWorkUnitId(group),
            order: policy.order,
            resourceConstraints: emptyWorkUnitResourceConstraints,
            scheduling: policy.scheduling,
            work,
            workerLifecycle: policy.workerLifecycle
        };
}

function groupFileWorkUnits(
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>,
    policy: WorkUnitPolicy,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    return groupedFiles(input.selectedPlan, group, fileSets).flatMap(function toFileWorkUnit(file) {
        const unit = fileWorkUnit(file, policy, group.name, input.seed);

        return unit === null ? [] : [ unit ];
    });
}

function groupCaseWorkUnits(
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>,
    policy: WorkUnitPolicy,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    return groupedFiles(input.selectedPlan, group, fileSets).flatMap(function toCaseUnits(file) {
        return workFromCases(file).map(function toCaseWorkUnit(work) {
            return caseWorkUnit(work, policy, group.name);
        });
    });
}

function groupWorkUnits(
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    const policy = groupPolicy(group, input);

    if (group.granularity === 'case') {
        return groupCaseWorkUnits(group, fileSets, policy, input);
    }

    if (group.granularity === 'file') {
        return groupFileWorkUnits(group, fileSets, policy, input);
    }

    const unit = groupWorkUnit(group, fileSets, policy, input);

    return unit === null ? [] : [ unit ];
}

function unmatchedFileUnits(
    distribution: GroupWorkDistribution,
    fileSets: ReadonlyMap<string, string>,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    if (distribution.unmatched === 'reject') {
        return [];
    }

    const policy = profilePolicy(input);

    return input.selectedPlan.files.flatMap(function toUnmatchedFileUnit(file) {
        const fileSet = fileSets.get(file.file);

        if (fileSet === undefined || selectedGroupName(distribution, fileSet) !== null) {
            return [];
        }

        const unit = fileWorkUnit(file, policy, null, input.seed);

        return unit === null ? [] : [ unit ];
    });
}

function caseOrder(plan: CollectedRunPlan): ReadonlyMap<string, number> {
    return new Map(
        collectedRunCaseEntries(plan).map(function toEntry(entry, index) {
            return [ caseIdentityKey(entry.id), index ];
        })
    );
}

function unitPosition(
    unit: WorkUnit,
    orderedCases: ReadonlyMap<string, number>
): number {
    return Math.min(
        ...unit.work.map(function toPosition(work) {
            const position = orderedCases.get(caseIdentityKey(work.case));

            if (position === undefined) {
                throw new Error('Planned work unit referenced an unknown collected case.');
            }

            return position;
        })
    );
}

function planWorkUnit(unit: WorkUnit, orderedCases: ReadonlyMap<string, number>): PlannedWorkUnit {
    return {
        bucket: unit.group,
        order: unit.order,
        position: unitPosition(unit, orderedCases),
        unit
    };
}

function bucketKey(unit: PlannedWorkUnit): string {
    return unit.bucket ?? '<unmatched>';
}

function orderedBucketUnits(
    units: readonly PlannedWorkUnit[],
    seed: RunSeed
): readonly PlannedWorkUnit[] {
    const firstUnit = units[0];

    if (firstUnit === undefined) {
        return [];
    }

    return orderedRunItems(units, firstUnit.order, seed);
}

function comparePlannedPosition(left: PlannedWorkUnit, right: PlannedWorkUnit): number {
    return left.position - right.position;
}

function unitsWithLocalOrder(
    units: readonly WorkUnit[],
    plan: CollectedRunPlan,
    globalOrder: RunOrder,
    seed: RunSeed
): readonly WorkUnit[] {
    const orderedCases = caseOrder(plan);
    const profileOrderedUnits = units
        .map(function toPlannedUnit(unit) {
            return planWorkUnit(unit, orderedCases);
        })
        .toSorted(comparePlannedPosition);
    const globallyOrderedUnits = orderedRunItems(profileOrderedUnits, globalOrder, seed);
    const buckets = Map.groupBy(profileOrderedUnits, bucketKey);
    const bucketQueues = new Map(
        Array.from(buckets, function toOrderedBucket([ key, bucket ]) {
            return [ key, Array.from(orderedBucketUnits(bucket, seed)) ];
        })
    );
    const bucketIndexes = new Map<string, number>();

    return globallyOrderedUnits.map(function fillSlot(slot) {
        const key = bucketKey(slot);
        const bucket = bucketQueues.get(key);
        const nextIndex = bucketIndexes.get(key) ?? 0;
        const nextUnit = bucket?.[nextIndex];

        if (nextUnit === undefined) {
            throw new Error('Grouped work distribution lost a planned work unit.');
        }

        bucketIndexes.set(key, nextIndex + 1);

        return nextUnit.unit;
    });
}

function groupWorkUnitsFromCollectedPlan(
    distribution: GroupWorkDistribution,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    const fileSets = distribution.unmatched === 'reject'
        ? assertNoUnmatchedSelectedFileSets(input.selectedPlan, distribution, input.fileSetForFile)
        : selectedFileSets(input.selectedPlan, input.fileSetForFile);
    const units = [
        ...distribution.groups.flatMap(function toGroupUnits(group) {
            return groupWorkUnits(group, fileSets, input);
        }),
        ...unmatchedFileUnits(distribution, fileSets, input)
    ];

    return unitsWithLocalOrder(units, input.selectedPlan, input.order, input.seed);
}

export function workUnitsFromCollectedPlan(
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    if (input.workDistribution.mode === 'case') {
        return workUnitsWithResourceConstraints(caseWorkUnitsFromCollectedPlan(input), input.selectedPlan);
    }

    if (input.workDistribution.mode === 'group') {
        return workUnitsWithResourceConstraints(
            groupWorkUnitsFromCollectedPlan(input.workDistribution, input),
            input.selectedPlan
        );
    }

    return workUnitsWithResourceConstraints(fileWorkUnitsFromCollectedPlan(input), input.selectedPlan);
}

export function createWorkerPoolPlacementPlan(input: WorkerPoolPlacementPlanInput): PlacementPlan {
    const units = workUnitsFromCollectedPlan(input);
    const lanes = workerPoolLanes({
        assignmentPolicy: input.assignmentPolicy,
        availableParallelism: input.availableParallelism,
        units
    });

    return {
        assignments: workerPoolPlacementAssignments(units, lanes, input.assignmentPolicy),
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
