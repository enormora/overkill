import {
    createCaseId,
    createDefaultWorkId,
    runtimeIdentityKey,
    workIdentityKey,
    type WorkId,
    type WorkloadId
} from '../engine/identity.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { CollectedRunFile, RunWorkGroup, WorkUnitId } from './run-types.ts';

function suiteTitles(suitePath: CollectedRunFile['cases'][number]['suitePath']): readonly string[] {
    return suitePath.map(function toTitle(entry) {
        return entry.title;
    });
}

function collectedCaseDefaultWorkId(file: string, testCase: CollectedRunFile['cases'][number]): WorkId {
    return createDefaultWorkId(createCaseId(file, suiteTitles(testCase.suitePath), testCase.title, testCase.params));
}

function orderedRecordEntries(record: Readonly<Record<string, string>>): readonly [string, string][] {
    return Object.entries(record).toSorted(function compareKeys([ left ], [ right ]) {
        return left.localeCompare(right);
    });
}

function workloadIdentityKey(workload: WorkloadId | null): string {
    return workload === null
        ? 'null'
        : JSON.stringify([ workload.name, orderedRecordEntries(workload.params) ]);
}

function executionBucketKey(work: WorkId): string {
    return JSON.stringify([ runtimeIdentityKey(work.runtime), workloadIdentityKey(work.workload) ]);
}

export function groupedExecutionBuckets(work: readonly WorkId[]): readonly NonEmptyReadonlyArray<WorkId>[] {
    return Array.from(Map.groupBy(work, executionBucketKey).values(), function toNonEmptyBucket(bucket) {
        const firstWork = bucket[0];

        if (firstWork === undefined) {
            throw new Error('Grouped execution bucket unexpectedly contained no work.');
        }

        return [ firstWork, ...bucket.slice(1) ];
    });
}

export function fileWorkUnitId(file: string, work: WorkId): WorkUnitId {
    return {
        key: file,
        mode: 'file',
        runtime: work.runtime,
        workload: work.workload
    };
}

export function caseWorkUnitId(work: WorkId): WorkUnitId {
    return {
        key: workIdentityKey(work),
        mode: 'case',
        runtime: work.runtime,
        workload: work.workload
    };
}

export function groupWorkUnitId(group: RunWorkGroup, work: WorkId): WorkUnitId {
    return {
        key: group.name,
        mode: 'group',
        runtime: work.runtime,
        workload: work.workload
    };
}

export function workFromCases(file: CollectedRunFile): readonly WorkId[] {
    return file.cases.map(function toWork(testCase) {
        return testCase.workId ?? collectedCaseDefaultWorkId(file.file, testCase);
    });
}
