import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import {
    workIdentityKey,
    type WorkId
} from '../engine/identity.ts';
import {
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import { invalidRequest } from './run-errors.ts';
import {
    type RunShardHasher,
    workUnitBelongsToShard
} from './run-sharding.ts';
import { orderedRunItems } from './run-selection.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunFile,
    type CollectedRunPlan,
    type RunOrder,
    type RunSeed,
    type RunShard,
    type RunScheduling,
    type RunWorkDistribution,
    type RunWorkGroup,
    type RunWorkerLifecycle,
    type WorkUnit
} from './run-types.ts';
import { workResourceConstraints } from './work-unit-resource-constraints.ts';
import {
    caseWorkUnitId,
    fileWorkUnitId,
    groupedExecutionBuckets,
    groupWorkUnitId,
    workFromCases
} from './work-unit-identity.ts';

type GroupWorkDistribution = Extract<RunWorkDistribution, { readonly mode: 'group'; }>;

type WorkUnitShardInput = {
    readonly shard: RunShard;
    readonly shardHasher: RunShardHasher | null;
} | Record<never, never>;

type WorkUnitPlanningBaseInput = {
    readonly fileSetForFile: (file: string) => string | null;
    readonly order: RunOrder;
    readonly seed: RunSeed;
    readonly selectedPlan: CollectedRunPlan;
    readonly scheduling: RunScheduling;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type WorkUnitPlanningInput = WorkUnitPlanningBaseInput & WorkUnitShardInput;

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

const defaultRunShard: RunShard = Object.freeze({ index: 1, total: 1 });

function readRunShard(input: WorkUnitPlanningInput): RunShard {
    return 'shard' in input ? input.shard : defaultRunShard;
}

function readRunShardHasher(input: WorkUnitPlanningInput): RunShardHasher | null {
    return 'shardHasher' in input ? input.shardHasher : null;
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

function orderedNonEmptyWork(
    work: NonEmptyReadonlyArray<WorkId>,
    policy: WorkUnitPolicy,
    seed: RunSeed
): NonEmptyReadonlyArray<WorkId> {
    const orderedWork = orderedRunItems(work, policy.order, seed);
    const firstWork = orderedWork[0];

    if (firstWork === undefined) {
        throw new Error('Ordered execution bucket unexpectedly contained no work.');
    }

    return [ firstWork, ...orderedWork.slice(1) ];
}

type FileWorkUnitInput = {
    readonly file: string;
    readonly group: string | null;
    readonly policy: WorkUnitPolicy;
    readonly seed: RunSeed;
    readonly workItems: NonEmptyReadonlyArray<WorkId>;
};

function fileWorkUnit(input: FileWorkUnitInput): WorkUnit {
    const work = orderedNonEmptyWork(input.workItems, input.policy, input.seed);

    return {
        group: input.group,
        id: fileWorkUnitId(input.file, work[0]),
        order: input.policy.order,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        scheduling: input.policy.scheduling,
        workerLifecycle: input.policy.workerLifecycle,
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

    return input.selectedPlan.files.flatMap(function toWorkUnit(file) {
        return groupedExecutionBuckets(workFromCases(file)).map(function toBucketUnit(work) {
            return fileWorkUnit({ file: file.file, group: null, policy, seed: input.seed, workItems: work });
        });
    });
}

function caseWorkUnitsFromCollectedPlan(input: WorkUnitPlanningInput): readonly WorkUnit[] {
    const policy = profilePolicy(input);

    return input.selectedPlan.files.flatMap(function toWorkUnits(file) {
        return workFromCases(file).map(function toCaseWorkUnit(work) {
            return caseWorkUnit(work, policy, null);
        });
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
): readonly WorkUnit[] {
    const buckets = groupedExecutionBuckets(groupedFiles(input.selectedPlan, group, fileSets).flatMap(workFromCases));

    return buckets.flatMap(function toGroupUnit(bucket) {
        const work = orderedNonEmptyWork(bucket, policy, input.seed);

        return [ {
            group: group.name,
            id: groupWorkUnitId(group, work[0]),
            order: policy.order,
            resourceConstraints: emptyWorkUnitResourceConstraints,
            scheduling: policy.scheduling,
            work,
            workerLifecycle: policy.workerLifecycle
        } ];
    });
}

function groupFileWorkUnits(
    group: RunWorkGroup,
    fileSets: ReadonlyMap<string, string>,
    policy: WorkUnitPolicy,
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    return groupedFiles(input.selectedPlan, group, fileSets).flatMap(function toFileWorkUnit(file) {
        return groupedExecutionBuckets(workFromCases(file)).map(function toBucketUnit(work) {
            return fileWorkUnit({
                file: file.file,
                group: group.name,
                policy,
                seed: input.seed,
                workItems: work
            });
        });
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

    return groupWorkUnit(group, fileSets, policy, input);
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

        return groupedExecutionBuckets(workFromCases(file)).map(function toBucketUnit(work) {
            return fileWorkUnit({ file: file.file, group: null, policy, seed: input.seed, workItems: work });
        });
    });
}

function caseOrder(plan: CollectedRunPlan): ReadonlyMap<string, number> {
    return new Map(
        collectedRunCaseEntries(plan).map(function toEntry(entry, index) {
            return [ workIdentityKey(entry.workId), index ];
        })
    );
}

function unitPosition(
    unit: WorkUnit,
    orderedCases: ReadonlyMap<string, number>
): number {
    return Math.min(
        ...unit.work.map(function toPosition(work) {
            const position = orderedCases.get(workIdentityKey(work));

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

    return units;
}

export function workUnitsFromCollectedPlan(
    input: WorkUnitPlanningInput
): readonly WorkUnit[] {
    const units = input.workDistribution.mode === 'case'
        ? caseWorkUnitsFromCollectedPlan(input)
        : input.workDistribution.mode === 'group'
            ? groupWorkUnitsFromCollectedPlan(input.workDistribution, input)
            : fileWorkUnitsFromCollectedPlan(input);
    const shardedUnits = units.filter(function unitBelongsToShard(unit) {
        return workUnitBelongsToShard(unit.id, readRunShard(input), readRunShardHasher(input));
    });

    return workUnitsWithResourceConstraints(
        unitsWithLocalOrder(shardedUnits, input.selectedPlan, input.order, input.seed),
        input.selectedPlan
    );
}
