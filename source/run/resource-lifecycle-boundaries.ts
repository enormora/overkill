import { runtimeIdentityKey, workIdentityKey, type RuntimeId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type {
    TestBodyLeafRuntimeSummary,
    TestBodyResourceSummary,
    TestBodyRuntimeScenarioBindingSummary,
    TestBodyRuntimeSummary
} from '../engine/test-body-resource-attachment.ts';
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

function selectedRuntimeId(testCase: TestPlanCase, runtime: TestBodyRuntimeSummary): RuntimeId {
    const selected = testCase.workId.runtimes.find(function runtimeNameMatches(candidate) {
        return candidate.name === runtime.name;
    });

    if (selected !== undefined) {
        return selected;
    }

    if (runtime.kind === 'runtime-matrix') {
        const variant = runtime.variants[0];

        if (variant === undefined) {
            throw new TypeError(`Runtime matrix "${runtime.name}" has no selected variant.`);
        }

        return { dimensions: variant.runtime.dimensions, name: runtime.name, variantId: variant.id };
    }

    return { dimensions: runtime.dimensions, name: runtime.name, variantId: null };
}

function selectedLeafRuntime(runtime: TestBodyRuntimeSummary): TestBodyLeafRuntimeSummary {
    if (runtime.kind !== 'runtime-matrix') {
        return runtime;
    }

    const variant = runtime.variants[0];

    if (variant === undefined) {
        throw new TypeError(`Runtime matrix "${runtime.name}" has no selected variant.`);
    }

    return variant.runtime;
}

type LifecycleScenarioBinding = {
    readonly key: string;
    readonly resourceName: string;
    readonly scope: ResourceScope;
    readonly slot: string;
    readonly value: string;
};

function lifecycleScenarioBinding(
    testCase: TestPlanCase,
    runtimeKey: string,
    resource: TestBodyResourceSummary | undefined,
    binding: TestBodyRuntimeScenarioBindingSummary
): LifecycleScenarioBinding | null {
    if (resource === undefined || !isResourceScope(resource.scope) || resource.scope === 'per-case') {
        return null;
    }

    const scopedResourceName = `${resource.name}@${runtimeKey}`;
    const boundary = resourceBoundary(scopedResourceName, resource.scope, testCase);

    return {
        key: `${boundary.key}:${binding.name}`,
        resourceName: resource.name,
        scope: resource.scope,
        slot: binding.name,
        value: binding.value
    };
}

function caseLifecycleScenarioBindings(testCase: TestPlanCase): readonly LifecycleScenarioBinding[] {
    const resourcesByName = new Map(testCase.resourceAttachments.resourceGraph.map(function resourceEntry(resource) {
        return [ resource.name, resource ] as const;
    }));

    return testCase.resourceAttachments.runtimeGraphs.flatMap(function runtimeBindings(runtime) {
        const runtimeKey = runtimeIdentityKey(selectedRuntimeId(testCase, runtime));

        return selectedLeafRuntime(runtime).scenarioBindings.flatMap(function resourceBinding(binding) {
            const resolved = lifecycleScenarioBinding(
                testCase,
                runtimeKey,
                resourcesByName.get(binding.owner.resourceName),
                binding
            );

            return resolved === null ? [] : [ resolved ];
        });
    });
}

function recordCompatibleBinding(
    valuesByBoundaryAndSlot: ReadonlyMap<string, string>,
    binding: LifecycleScenarioBinding
): ReadonlyMap<string, string> {
    const existing = valuesByBoundaryAndSlot.get(binding.key);

    if (existing !== undefined && existing !== binding.value) {
        const messageParts = [
            `Resource "${binding.resourceName}" scenario "${binding.slot}" has conflicting values`,
            `"${existing}" and "${binding.value}" within one ${binding.scope} lifecycle boundary.`
        ];

        throw new TypeError(messageParts.join(' '));
    }

    return new Map([ ...valuesByBoundaryAndSlot, [ binding.key, binding.value ] ]);
}

function assertCompatibleScenarioBindings(testCases: readonly TestPlanCase[]): void {
    let valuesByBoundaryAndSlot: ReadonlyMap<string, string> = new Map();

    for (const testCase of testCases) {
        for (const binding of caseLifecycleScenarioBindings(testCase)) {
            valuesByBoundaryAndSlot = recordCompatibleBinding(valuesByBoundaryAndSlot, binding);
        }
    }
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
    assertCompatibleScenarioBindings(testCases);

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
