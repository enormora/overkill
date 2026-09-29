import { runtimeIdentityKey, workIdentityKey, type RuntimeId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type {
    TestBodyLeafRuntimeSummary,
    TestBodyResourceSummary,
    TestBodyRuntimeScenarioBindingSummary,
    TestBodyRuntimeSummary
} from '../engine/test-body-resource-attachment.ts';
import type { AnyResourceDefinition, ResourceScope } from '../resources/resources.ts';
import {
    resourceAcquisitionCacheIdentity,
    resourceDescriptorCacheIdentityNode,
    type ResourceCacheIdentityNode
} from './resource-lifecycle-cache-identity.ts';

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

function resourceNameWithAcquisitionIdentity(resourceName: string, acquisitionIdentity: string): string {
    return acquisitionIdentity === ''
        ? resourceName
        : `${resourceName}:acquisition:${acquisitionIdentity}`;
}

function resourceBoundary(
    resourceName: string,
    scope: ResourceScope,
    testCase: TestPlanCase,
    acquisitionIdentity: string
): LifecycleBoundary {
    const identifiedResourceName = resourceNameWithAcquisitionIdentity(resourceName, acquisitionIdentity);
    const file = testCase.id.file ?? '<no-file>';

    if (scope === 'per-run') {
        return { key: `run:${identifiedResourceName}`, scope };
    }

    if (scope === 'per-file') {
        return { key: `file:${file}:${identifiedResourceName}`, scope };
    }

    if (scope === 'per-suite') {
        return { key: `suite:${file}:${suiteBoundary(testCase)}:${identifiedResourceName}`, scope };
    }

    return resourceBoundaryForCase(identifiedResourceName, scope, testCase);
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

function selectedLeafRuntime(testCase: TestPlanCase, runtime: TestBodyRuntimeSummary): TestBodyLeafRuntimeSummary {
    if (runtime.kind !== 'runtime-matrix') {
        return runtime;
    }

    const selected = selectedRuntimeId(testCase, runtime);
    const variant = runtime.variants.find(function variantMatches(candidate) {
        return candidate.id === selected.variantId;
    });

    if (variant === undefined) {
        throw new TypeError(`Runtime matrix "${runtime.name}" has no selected variant.`);
    }

    return variant.runtime;
}

type ScenarioBindingsByResource = ReadonlyMap<string, ReadonlyMap<string, TestBodyRuntimeScenarioBindingSummary>>;

function scenarioBindingsByResource(runtime: TestBodyLeafRuntimeSummary): ScenarioBindingsByResource {
    const bindings = new Map<string, Map<string, TestBodyRuntimeScenarioBindingSummary>>();

    for (const binding of runtime.scenarioBindings) {
        const resourceBindings = bindings.get(binding.owner.resourceName) ??
            new Map<string, TestBodyRuntimeScenarioBindingSummary>();

        resourceBindings.set(binding.name, binding);
        bindings.set(binding.owner.resourceName, resourceBindings);
    }

    return bindings;
}

function resourceSummaryCacheIdentityNode(
    resource: TestBodyResourceSummary,
    resourcesByName: ReadonlyMap<string, TestBodyResourceSummary>,
    bindingsByResource: ScenarioBindingsByResource
): ResourceCacheIdentityNode {
    const bindings = bindingsByResource.get(resource.name) ??
        new Map<string, TestBodyRuntimeScenarioBindingSummary>();

    return {
        dependencies: resource.dependencies.flatMap(function dependencyNode(dependencyName) {
            const dependency = resourcesByName.get(dependencyName);

            return dependency === undefined
                ? []
                : [ {
                    key: dependency.name,
                    resource: resourceSummaryCacheIdentityNode(dependency, resourcesByName, bindingsByResource)
                } ];
        }),
        scenarios: resource.scenarios.map(function scenarioBinding(scenario) {
            return {
                name: scenario.name,
                timing: scenario.timing,
                value: bindings.get(scenario.name)?.value ?? scenario.default
            };
        })
    };
}

function resourceGraphBoundaries(
    testCase: TestPlanCase,
    rootResourceNames: readonly string[],
    resourceName: (resource: TestBodyResourceSummary) => string,
    bindingsByResource: ScenarioBindingsByResource
): readonly LifecycleBoundary[] {
    const resourcesByName = new Map(testCase.resourceAttachments.resourceGraph.map(function resourceEntry(resource) {
        return [ resource.name, resource ] as const;
    }));
    const visited = new Set<string>();
    const boundaries: LifecycleBoundary[] = [];

    function recordBoundary(resource: TestBodyResourceSummary): void {
        if (!isResourceScope(resource.scope)) {
            return;
        }

        const identity = resourceAcquisitionCacheIdentity(
            resourceSummaryCacheIdentityNode(resource, resourcesByName, bindingsByResource)
        );

        boundaries.push(resourceBoundary(resourceName(resource), resource.scope, testCase, identity));
    }

    function visit(name: string): void {
        if (visited.has(name)) {
            return;
        }

        const resource = resourcesByName.get(name);

        if (resource === undefined) {
            return;
        }

        visited.add(name);

        for (const dependencyName of resource.dependencies) {
            visit(dependencyName);
        }

        recordBoundary(resource);
    }

    for (const rootResourceName of rootResourceNames) {
        visit(rootResourceName);
    }

    return boundaries;
}

function caseResourceBoundaries(testCase: TestPlanCase): readonly LifecycleBoundary[] {
    const directBoundaries = resourceGraphBoundaries(
        testCase,
        testCase.resourceAttachments.directResources.map(function directResourceName(resource) {
            return resource.resourceName;
        }),
        function directResourceName(resource) {
            return resource.name;
        },
        new Map()
    );
    const runtimeBoundaries = testCase.resourceAttachments.runtimeGraphs.flatMap(function runtimeResources(runtime) {
        const runtimeKey = runtimeIdentityKey(selectedRuntimeId(testCase, runtime));
        const selectedRuntime = selectedLeafRuntime(testCase, runtime);

        return resourceGraphBoundaries(
            testCase,
            selectedRuntime.resources.map(function runtimeResourceName(resource) {
                return resource.resourceName;
            }),
            function scopedResourceName(resource) {
                return `${resource.name}@${runtimeKey}`;
            },
            scenarioBindingsByResource(selectedRuntime)
        );
    });
    const boundaries = new Map(
        [ ...directBoundaries, ...runtimeBoundaries ].map(function boundaryEntry(boundary) {
            return [ boundary.key, boundary ] as const;
        })
    );

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
    return resourceBoundary(
        resource.name,
        resource.scope,
        testCase,
        resourceAcquisitionCacheIdentity(resourceDescriptorCacheIdentityNode(resource))
    );
}
