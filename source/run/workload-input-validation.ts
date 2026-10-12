import { isDeepStrictEqual } from 'node:util';
import { workIdentityKey } from '../engine/identity.ts';
import type { WorkloadParameters } from '../engine/workload-input.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { CollectedRunPlan, FrozenWorkloadInput } from './run-types.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import { caseResourceOwnershipBoundaries } from './resource-lifecycle-boundaries.ts';

function assertFrozenInput(testCase: TestPlan['cases'][number], parameters: WorkloadParameters | null): void {
    if (!isDeepStrictEqual(testCase.workloadParameters, parameters)) {
        throw new TypeError(`Workload parameters changed after collection for "${testCase.id.title}".`);
    }
}

export function assertFrozenWorkloadInputs(plan: TestPlan, inputs: readonly FrozenWorkloadInput[]): void {
    const parametersByWork = new Map(inputs.map(function workloadEntry(input) {
        return [ workIdentityKey(input.work), input.parameters ];
    }));
    for (const testCase of plan.cases) {
        const parameters = parametersByWork.get(workIdentityKey(testCase.workId));
        if (parameters === undefined) {
            if (testCase.workloadParameters !== null) {
                throw new TypeError(`Missing frozen workload parameters for "${testCase.id.title}".`);
            }
        } else {
            assertFrozenInput(testCase, parameters);
        }
    }
}

type CollectedCaseEntry = ReturnType<typeof collectedRunCaseEntries>[number];

function sharedWorkloadBoundaries(entry: CollectedCaseEntry): ReturnType<typeof caseResourceOwnershipBoundaries> {
    const boundaries = caseResourceOwnershipBoundaries({
        id: entry.workId.case,
        resourceAttachments: entry.testCase.resourceAttachments,
        workId: entry.workId
    });
    return boundaries.filter(function sharedWorkloadBoundary(boundary) {
        return boundary.scope !== 'per-case' &&
            entry.testCase.resourceAttachments.resourceGraph.some(function requiresWorkload(resource) {
                return resource.name === boundary.resourceName && resource.workload === 'required';
            });
    });
}

type SharedWorkloadInputs = {
    readonly read: (key: string) => WorkloadParameters | null | undefined;
    readonly remember: (key: string, parameters: WorkloadParameters | null) => void;
};

function rememberSharedInput(
    parametersByBoundary: SharedWorkloadInputs,
    entry: CollectedCaseEntry
): void {
    for (const boundary of sharedWorkloadBoundaries(entry)) {
        const previous = parametersByBoundary.read(boundary.key);
        if (previous !== undefined && !isDeepStrictEqual(previous, entry.testCase.workloadParameters)) {
            throw new TypeError(
                `Resource "${boundary.resourceName}" has conflicting parameters for one workload identity.`
            );
        }
        parametersByBoundary.remember(boundary.key, entry.testCase.workloadParameters);
    }
}

export function assertSharedWorkloadInputs(plan: CollectedRunPlan): void {
    const parametersByBoundary = new Map<string, WorkloadParameters | null>();
    for (const entry of collectedRunCaseEntries(plan)) {
        rememberSharedInput({
            read(key) {
                return parametersByBoundary.get(key);
            },
            remember(key, parameters) {
                parametersByBoundary.set(key, parameters);
            }
        }, entry);
    }
}
