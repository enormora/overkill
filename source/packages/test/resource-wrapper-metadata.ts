import type {
    TestBodyDirectResourceAttachmentSummary,
    TestBodyLeafRuntimeSummary,
    TestBodyResourceAttachments,
    TestBodyResourceSummary,
    TestBodyRuntimeSummary
} from '../engine/engine.entry-point.ts';
import {
    resolvedRuntimeScenarioOwners,
    type AnyResourceDefinition,
    type RuntimeGraph,
    type RuntimeGraphLeaf,
    type RuntimeMatrixDefinition
} from '../resources/resources.entry-point.ts';
import {
    directResourceEntries,
    ensureResourceDescriptor,
    stepRuntimeGraphs,
    type ResourceEntry,
    type ResourceWrapperAction
} from './resource-wrapper-data.ts';
import { resourceHandleTransport } from './resource-wrapper-implementations.ts';

type ResourceGraphCollector = {
    readonly resourceGraph: () => readonly TestBodyResourceSummary[];
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => void;
};

function resourceSummary(resource: AnyResourceDefinition): TestBodyResourceSummary {
    return {
        dependencies: Object.values(resource.dependencies).map(function dependencyName(dependency) {
            return dependency.name;
        }),
        handleTransport: resourceHandleTransport(resource),
        name: resource.name,
        requirements: resource.requirements.map(function (requirement) {
            return { ...requirement };
        }),
        scenarios: Object.entries(resource.scenarios).map(function scenarioSummary([ name, scenario ]) {
            return {
                default: scenario.default,
                name,
                timing: scenario.timing,
                values: scenario.values
            };
        }),
        scope: resource.scope,
        workload: resource.workload === null ? 'independent' : 'required'
    };
}

function assertUniqueResourceName(
    descriptorsByName: ReadonlyMap<string, AnyResourceDefinition>,
    descriptor: AnyResourceDefinition
): void {
    const descriptorForName = descriptorsByName.get(descriptor.name);

    if (descriptorForName !== undefined && descriptorForName !== descriptor) {
        throw new TypeError(`Resource name "${descriptor.name}" is used by multiple descriptors.`);
    }
}

function assertResourceAcyclic(
    traversal: ReadonlySet<AnyResourceDefinition>,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    if (traversal.has(descriptor)) {
        throw new TypeError(`Resource dependency cycle detected: ${path.join(' -> ')}.`);
    }
}

function assertResourceCanBeRecorded(
    descriptorsByName: ReadonlyMap<string, AnyResourceDefinition>,
    traversal: ReadonlySet<AnyResourceDefinition>,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    assertUniqueResourceName(descriptorsByName, descriptor);
    assertResourceAcyclic(traversal, descriptor, path);
}

function visitDependencies(
    collector: ResourceGraphCollector,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    for (const dependency of Object.values(descriptor.dependencies)) {
        collector.visit(dependency, [ ...path, dependency.name ]);
    }
}

function createResourceGraphCollector(): ResourceGraphCollector {
    const descriptorsByName = new Map<string, AnyResourceDefinition>();
    const resourceGraph: TestBodyResourceSummary[] = [];
    const recorded = new Set<AnyResourceDefinition>();
    const traversal = new Set<AnyResourceDefinition>();
    const collector: ResourceGraphCollector = {
        resourceGraph() {
            return resourceGraph;
        },
        visit(resource, path) {
            const descriptor = ensureResourceDescriptor(
                resource,
                'resource attachment() requires resource descriptors.'
            );

            assertResourceCanBeRecorded(descriptorsByName, traversal, descriptor, path);
            descriptorsByName.set(descriptor.name, descriptor);

            if (recorded.has(descriptor)) {
                return;
            }

            traversal.add(descriptor);
            visitDependencies(collector, descriptor, path);
            traversal.delete(descriptor);
            recorded.add(descriptor);
            resourceGraph.push(resourceSummary(descriptor));
        }
    };

    return collector;
}

function resourceAttachmentSummary(entry: ResourceEntry): TestBodyDirectResourceAttachmentSummary {
    return {
        key: entry.key,
        resourceName: entry.resource.name
    };
}

function runtimeVariantEntries(
    runtimeGraph: RuntimeGraphLeaf
): readonly { readonly id: string; readonly runtime: RuntimeMatrixDefinition['variants'][string]['runtime']; }[] {
    return runtimeGraph.kind === 'runtime-matrix'
        ? Object.values(runtimeGraph.variants)
        : [ { id: runtimeGraph.name, runtime: runtimeGraph } ];
}

function leafRuntimeSummary(
    runtimeGraph: RuntimeMatrixDefinition['variants'][string]['runtime']
): TestBodyLeafRuntimeSummary {
    return {
        dimensions: runtimeGraph.dimensions,
        kind: 'runtime',
        name: runtimeGraph.name,
        requirements: runtimeGraph.requirements.map(function (requirement) {
            return { ...requirement };
        }),
        resources: Object.entries(runtimeGraph.resources).map(function runtimeResourceSummary([ key, resource ]) {
            return {
                key,
                resourceName: resource.name
            };
        }),
        scenarioBindings: Array.from(resolvedRuntimeScenarioOwners(runtimeGraph), function scenarioBinding([
            name,
            owner
        ]) {
            return {
                default: owner.slot.default,
                name,
                owner: {
                    path: owner.path,
                    resourceName: owner.resource.name
                },
                timing: owner.slot.timing,
                value: owner.value,
                values: owner.slot.values
            };
        })
    };
}

function runtimeSummary(runtimeGraph: RuntimeGraph): TestBodyRuntimeSummary {
    if (runtimeGraph.kind === 'composed-runtimes') {
        throw new TypeError('Composed runtime graphs must be flattened before summary creation.');
    }

    if (runtimeGraph.kind === 'runtime-matrix') {
        const [ firstVariant ] = Object.values(runtimeGraph.variants);

        if (firstVariant === undefined) {
            throw new TypeError(`Runtime matrix "${runtimeGraph.name}" requires at least one variant.`);
        }

        return {
            kind: 'runtime-matrix',
            name: runtimeGraph.name,
            resources: leafRuntimeSummary(firstVariant.runtime).resources,
            variants: Object.values(runtimeGraph.variants).map(function variantSummary(variant) {
                return {
                    id: variant.id,
                    runtime: leafRuntimeSummary(variant.runtime)
                };
            })
        };
    }

    return leafRuntimeSummary(runtimeGraph);
}

function buildAttachments(
    directResources: readonly ResourceEntry[],
    runtimeGraphEntries: readonly RuntimeGraph[]
): TestBodyResourceAttachments {
    const graphCollector = createResourceGraphCollector();

    for (const entry of directResources) {
        graphCollector.visit(entry.resource, [ entry.resource.name ]);
    }

    for (const runtimeGraph of runtimeGraphEntries) {
        if (runtimeGraph.kind === 'composed-runtimes') {
            throw new TypeError('Composed runtime graphs must be flattened before resource graph collection.');
        }

        for (const variant of runtimeVariantEntries(runtimeGraph)) {
            for (const resource of Object.values(variant.runtime.resources)) {
                graphCollector.visit(resource, [ resource.name ]);
            }
        }
    }

    return {
        directResources: directResources.map(resourceAttachmentSummary),
        resourceGraph: graphCollector.resourceGraph(),
        runtimeGraphs: runtimeGraphEntries.map(runtimeSummary)
    };
}

export function buildStepAttachments(actions: readonly ResourceWrapperAction[]): TestBodyResourceAttachments {
    return buildAttachments(directResourceEntries(actions), stepRuntimeGraphs(actions));
}
