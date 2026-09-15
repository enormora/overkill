import {
    type AnyResourceDefinition,
    type Awaitable,
    isDefinedResource,
    type ResourceCreationContext,
    type ResourceDependencies,
    type ResourceDisposalContext,
    type ResourceScope
} from './resources.ts';
import { resourceLifecycleError } from './resource-lifecycle-error.ts';

type ResourceGraphBuilder = {
    readonly build: (resources: ResourceDependencies) => ResourceGraph;
};
type ResourceGraphController = ResourceGraphBuilder & {
    readonly assertAcyclic: (resource: AnyResourceDefinition, path: readonly string[]) => void;
    readonly assertUniqueName: (resource: AnyResourceDefinition) => void;
    readonly record: (resource: AnyResourceDefinition, path: readonly string[]) => ResourceNode;
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => ResourceNode;
};

export type ResourceEntry = readonly [string, AnyResourceDefinition];
export type ResourceNode = {
    readonly dependencies: readonly ResourceNode[];
    readonly descriptor: AnyResourceDefinition;
};
export type ResourceGraph = {
    readonly order: readonly ResourceNode[];
    readonly topLevelEntries: readonly ResourceEntry[];
};
type DependencyDisposalContext = ResourceDisposalContext<ResourceDependencies>;
export type ResourceDisposeCallback = (handle: unknown, context: DependencyDisposalContext) => Awaitable<void>;
export type CallableResourceDefinition = AnyResourceDefinition & {
    readonly acquire: (context: ResourceCreationContext<ResourceDependencies>) => Awaitable<unknown>;
    readonly dispose: ResourceDisposeCallback | null;
};

export function resourceEntries(resources: ResourceDependencies): readonly ResourceEntry[] {
    return Object.entries(resources);
}

function scopeDescription(scope: ResourceScope): string {
    return scope === 'per-case'
        ? 'per-case scope'
        : `${scope} scope, which direct execution wrappers do not support yet`;
}

function hasCallableResourceCallbacks(resource: AnyResourceDefinition): resource is CallableResourceDefinition {
    return isDefinedResource(resource) && typeof resource.acquire === 'function';
}

export function callableResourceDefinition(resource: AnyResourceDefinition): CallableResourceDefinition {
    if (hasCallableResourceCallbacks(resource)) {
        return resource;
    }

    throw resourceLifecycleError('Resource descriptor is invalid.', [
        { cause: resource, phase: 'graph', resourceName: 'resource' }
    ], resource);
}

function assertUniqueResourceName(
    descriptorsByName: ReadonlyMap<string, AnyResourceDefinition>,
    resource: AnyResourceDefinition
): void {
    const descriptorForName = descriptorsByName.get(resource.name);

    if (descriptorForName !== undefined && descriptorForName !== resource) {
        throw resourceLifecycleError(`Resource name "${resource.name}" is used by multiple descriptors.`, [
            { cause: resource, phase: 'graph', resourceName: resource.name }
        ], resource);
    }
}

function assertResourceAcyclic(
    traversal: ReadonlySet<AnyResourceDefinition>,
    resource: AnyResourceDefinition,
    path: readonly string[]
): void {
    if (traversal.has(resource)) {
        throw resourceLifecycleError(`Resource dependency cycle detected: ${path.join(' -> ')}.`, [
            { cause: resource, phase: 'graph', resourceName: resource.name }
        ], resource);
    }
}

function createResourceGraphBuilder(): ResourceGraphBuilder {
    const descriptorsByName = new Map<string, AnyResourceDefinition>();
    const nodesByDescriptor = new Map<AnyResourceDefinition, ResourceNode>();
    const order: ResourceNode[] = [];
    const traversal = new Set<AnyResourceDefinition>();
    const builder: ResourceGraphController = {
        assertAcyclic(resource, path) {
            assertResourceAcyclic(traversal, resource, path);
        },
        assertUniqueName(resource) {
            assertUniqueResourceName(descriptorsByName, resource);
            descriptorsByName.set(resource.name, resource);
        },
        build(resources) {
            const topLevelEntries = resourceEntries(resources);

            for (const [ , resource ] of topLevelEntries) {
                builder.visit(resource, [ resource.name ]);
            }

            return { order, topLevelEntries };
        },
        record(resource, path) {
            traversal.add(resource);

            const dependencies = resourceEntries(resource.dependencies).map(function visitDependency([ , dependency ]) {
                return builder.visit(dependency, [ ...path, dependency.name ]);
            });
            const node = { dependencies, descriptor: resource };

            traversal.delete(resource);
            nodesByDescriptor.set(resource, node);
            order.push(node);

            return node;
        },
        visit(resource, path) {
            const callableResource = callableResourceDefinition(resource);
            const existingNode = nodesByDescriptor.get(callableResource);

            builder.assertUniqueName(callableResource);
            builder.assertAcyclic(callableResource, path);

            if (existingNode !== undefined) {
                return existingNode;
            }

            return builder.record(callableResource, path);
        }
    };

    return builder;
}

export function createResourceGraph(resources: ResourceDependencies): ResourceGraph {
    return createResourceGraphBuilder().build(resources);
}

export function assertPerCaseResourceGraph(resources: ResourceDependencies): void {
    const graph = createResourceGraph(resources);
    const nonPerCaseResource = graph.order.find(function hasBroaderScope(node) {
        return node.descriptor.scope !== 'per-case';
    });

    if (nonPerCaseResource === undefined) {
        return;
    }

    throw resourceLifecycleError(
        `Resource "${nonPerCaseResource.descriptor.name}" uses ${
            scopeDescription(nonPerCaseResource.descriptor.scope)
        }.`,
        [
            {
                cause: nonPerCaseResource.descriptor,
                phase: 'graph',
                resourceName: nonPerCaseResource.descriptor.name
            }
        ],
        nonPerCaseResource.descriptor
    );
}
