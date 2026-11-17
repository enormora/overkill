import type { WorkloadId } from '../engine/identity.ts';
import { snapshotWorkloadInput, type WorkloadInput, type WorkloadParameters } from '../engine/workload-input.ts';
import { snapshotWorkloadParameters } from '../engine/workload-parameters.ts';
import { ResourceLifecycleError, resourceLifecycleError } from './resource-lifecycle-error.ts';
import { hasWorkloadInput, type ResourceWorkload } from './resource-workload-types.ts';
import { withWorkloadCallbacks } from './resource-workload-callbacks.ts';
import { createResourceGraph } from './resource-graph.ts';
import type { AnyResourceDefinition, ResourceDependencies } from './resource-definition-shape.ts';
import { inheritResourceDefinition, parentResourceDefinition } from './resource-scenario-binding.ts';

export type ResourceAcquisitionContext = {
    readonly acquisitionFailureMessage: string;
    readonly fallbackResourceName: string;
};
type ResourceWorkloadRequest = { readonly resources: ResourceDependencies; readonly workload: WorkloadInput; } | {
    readonly resources: ResourceDependencies;
};
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

type BoundWorkload = ResourceWorkload<WorkloadParameters>;

function withResourceWorkload(resource: AnyResourceDefinition, workload: BoundWorkload): AnyResourceDefinition {
    return resource.acquire === null
        ? {
            ...resource,
            implementation: {
                ...resource.implementation,
                workload
            }
        }
        : withWorkloadCallbacks(resource, workload);
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
    const bound = Object.freeze({ ...withResourceWorkload(resource, context), dependencies });
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

export function boundWorkloadResources(
    request: ResourceWorkloadRequest,
    context: ResourceAcquisitionContext
): ResourceDependencies {
    const workload = hasWorkloadInput(request) ? request.workload : null;
    try {
        const binding = createWorkloadResourceBinding(workload);
        return binding.resources(request.resources);
    } catch (error: unknown) {
        if (error instanceof ResourceLifecycleError) {
            throw error;
        }
        throw resourceLifecycleError(
            `${context.acquisitionFailureMessage} ${
                error instanceof Error ? error.message : 'Invalid workload input.'
            }`,
            [ { cause: error, phase: 'acquire', resourceName: context.fallbackResourceName } ],
            error
        );
    }
}
