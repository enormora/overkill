import type { WorkloadId } from '../engine/identity.ts';
import { snapshotWorkloadInput, type WorkloadInput } from '../engine/workload-input.ts';
import { snapshotWorkloadParameters } from '../engine/workload-parameters.ts';
import { createResourceGraph } from './resource-graph.ts';
import type { AnyResourceDefinition, ResourceDependencies } from './resource-definition-shape.ts';
import type { ResourceCreationContext, ResourceDisposalContext } from './resource-definition-types.ts';
import type { ResourceScenarioSlots } from './resource-scenario.ts';
import { inheritResourceDefinition, parentResourceDefinition } from './resource-scenario-binding.ts';

const resourceWorkloads = new WeakMap<AnyResourceDefinition, WorkloadInput>();

export function resourceWorkloadIdentity(resource: AnyResourceDefinition): WorkloadId | null {
    const bound = resourceWorkloads.get(resource);
    if (bound !== undefined) {
        return bound.id;
    }
    const parent = parentResourceDefinition(resource);
    return parent === null ? null : resourceWorkloadIdentity(parent);
}

export type WorkloadResourceBinding = {
    readonly resources: (resources: ResourceDependencies) => ResourceDependencies;
};
type ResourceBindingGraph = WorkloadResourceBinding & {
    readonly resource: (resource: AnyResourceDefinition) => AnyResourceDefinition;
};

function withBoundDependencies(
    resource: AnyResourceDefinition,
    dependencies: ResourceDependencies
): AnyResourceDefinition {
    if (
        Object.entries(dependencies).every(function unchangedDependency([ key, dependency ]) {
            return dependency === resource.dependencies[key];
        })
    ) {
        return resource;
    }
    const bound = Object.freeze({ ...resource, dependencies });
    inheritResourceDefinition(bound, resource);
    return bound;
}

function bindRequiredWorkload(
    resource: AnyResourceDefinition,
    dependencies: ResourceDependencies,
    workload: WorkloadInput
): AnyResourceDefinition {
    if (resource.workload === null) {
        throw new TypeError(`Resource "${resource.name}" does not declare workload dependence.`);
    }
    const parameters = resource.workload(workload.parameters);
    snapshotWorkloadParameters(parameters);
    const context = Object.freeze({ id: workload.id, parameters });
    const { dispose } = resource;
    const bound = Object.freeze({
        ...resource,
        dependencies,
        acquire(acquisition: ResourceCreationContext<ResourceDependencies, ResourceScenarioSlots>) {
            const handle: unknown = Reflect.apply(resource.acquire, undefined, [ {
                ...acquisition,
                workload: context
            } ]);
            return handle;
        },
        dispose: dispose === null
            ? null
            : async function disposeWorkloadResource(
                handle: unknown,
                disposal: ResourceDisposalContext<ResourceDependencies, ResourceScenarioSlots>
            ) {
                const completion: unknown = Reflect.apply(dispose, undefined, [ handle, {
                    ...disposal,
                    workload: context
                } ]);
                await completion;
            }
    });
    inheritResourceDefinition(bound, resource);
    resourceWorkloads.set(bound, workload);
    return bound;
}

function boundResource(
    resource: AnyResourceDefinition,
    dependencies: ResourceDependencies,
    workload: WorkloadInput | null
): AnyResourceDefinition {
    if (typeof resource.workload !== 'function' || resourceWorkloadIdentity(resource) !== null) {
        return withBoundDependencies(resource, dependencies);
    }
    if (workload === null) {
        throw new TypeError(`Resource "${resource.name}" requires workload parameters.`);
    }
    return bindRequiredWorkload(resource, dependencies, workload);
}

export function createWorkloadResourceBinding(input: WorkloadInput | null): WorkloadResourceBinding {
    const workload = input === null ? null : snapshotWorkloadInput(input);
    const boundResources = new Map<AnyResourceDefinition, AnyResourceDefinition>();
    const graph: ResourceBindingGraph = {
        resources(resources) {
            return Object.freeze(
                Object.fromEntries(
                    Object
                        .entries(resources)
                        .map(function bindEntry([ key, resource ]) {
                            return [ key, graph.resource(resource) ];
                        })
                )
            );
        },
        resource(resource) {
            const existing = boundResources.get(resource);
            if (existing !== undefined) {
                return existing;
            }
            const dependencies = graph.resources(resource.dependencies);
            const bound = boundResource(resource, dependencies, workload);
            boundResources.set(resource, bound);
            return bound;
        }
    };
    return {
        resources(resources) {
            createResourceGraph(resources);
            return graph.resources(resources);
        }
    };
}
