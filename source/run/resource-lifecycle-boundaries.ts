import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type { AnyResourceDefinition, ResourceScope } from '../resources/resources.ts';

export type LifecycleBoundary = {
    readonly key: string;
    readonly scope: ResourceScope;
};

export type ResourceBoundaryUseCount = {
    readonly boundaryKey: string;
    readonly count: number;
};

const resourceScopeValues: readonly ResourceScope[] = [
    'per-case',
    'per-file',
    'per-run',
    'per-suite',
    'shared-per-worker'
];

export const resourceScopes: ReadonlySet<ResourceScope> = new Set(resourceScopeValues);
const resourceScopeTexts: ReadonlySet<string> = new Set(resourceScopeValues);

function isResourceScope(scope: string): scope is ResourceScope {
    return resourceScopeTexts.has(scope);
}

function suiteBoundary(testCase: TestPlanCase): string {
    return JSON.stringify(testCase.id.suite);
}

function resourceBoundaryForCase(
    resourceName: string,
    scope: Extract<ResourceScope, 'per-case' | 'shared-per-worker'>,
    testCase: TestPlanCase
): LifecycleBoundary {
    return scope === 'shared-per-worker'
        ? { key: `worker:${resourceName}`, scope }
        : { key: `case:${workIdentityKey(testCase.workId)}:${resourceName}`, scope };
}

function resourceBoundary(
    resourceName: string,
    scope: ResourceScope,
    testCase: TestPlanCase
): LifecycleBoundary {
    const file = testCase.id.file ?? '<no-file>';

    if (scope === 'per-run') {
        return { key: `run:${resourceName}`, scope };
    }

    if (scope === 'per-file') {
        return { key: `file:${file}:${resourceName}`, scope };
    }

    if (scope === 'per-suite') {
        return { key: `suite:${file}:${suiteBoundary(testCase)}:${resourceName}`, scope };
    }

    return resourceBoundaryForCase(resourceName, scope, testCase);
}

function caseResourceBoundaries(testCase: TestPlanCase): readonly LifecycleBoundary[] {
    const boundaryEntries = testCase.resourceAttachments.resourceGraph.flatMap(function toBoundaryEntry(resource) {
        if (!isResourceScope(resource.scope)) {
            return [];
        }

        const boundary = resourceBoundary(resource.name, resource.scope, testCase);

        return [ [ boundary.key, boundary ] as const ];
    });
    const boundaries = new Map<string, LifecycleBoundary>(boundaryEntries);

    return Array.from(boundaries.values());
}

function initialBoundaryUseCounts(testCases: readonly TestPlanCase[]): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();

    for (const testCase of testCases) {
        for (const boundary of caseResourceBoundaries(testCase)) {
            counts.set(boundary.key, (counts.get(boundary.key) ?? 0) + 1);
        }
    }

    return counts;
}

export function initialBoundaryUseCountsFromRecords(
    counts: readonly ResourceBoundaryUseCount[]
): ReadonlyMap<string, number> {
    return new Map(counts.map(function toEntry(count) {
        return [ count.boundaryKey, count.count ];
    }));
}

export function resourceLifecycleBoundaryUseCounts(
    testCases: readonly TestPlanCase[]
): readonly ResourceBoundaryUseCount[] {
    return Array.from(initialBoundaryUseCounts(testCases), function toCount([ boundaryKey, count ]) {
        return { boundaryKey, count };
    });
}

export function caseResourceBoundaryKeys(
    testCase: TestPlanCase,
    scopes: ReadonlySet<ResourceScope>
): readonly string[] {
    return caseResourceBoundaries(testCase).flatMap(function toBoundaryKey(boundary) {
        return scopes.has(boundary.scope) ? [ boundary.key ] : [];
    });
}

export function boundaryFor(resource: AnyResourceDefinition, testCase: TestPlanCase): LifecycleBoundary {
    return resourceBoundary(resource.name, resource.scope, testCase);
}
