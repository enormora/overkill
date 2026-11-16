import { resourceReferenceCallbacks } from '../resources/resource-reference-binding.ts';
import { snapshotPortableValue } from '../portable-value.ts';
import { resourceAttachments } from '../packages/resources/attachment-context.entry-point.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceProjectionContext,
    ResourceProjectionPayload,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import { resourceWrapperLifecycleError } from './resource-lifecycle-error.ts';

type ResourceProjectionRecord = {
    readonly boundaryKey: string;
    readonly payload: ResourceProjectionPayload;
};

type SerializedProjection = { readonly payload: ResourceProjectionPayload; };

export type ResourceProjectionRecords = {
    readonly resources: readonly ResourceProjectionRecord[];
};

type ProjectedResourceDefinition = AnyResourceDefinition & {
    readonly deserializeHandle: (
        payload: ResourceProjectionPayload,
        context: ResourceProjectionContext<ResourceMap>
    ) => unknown;
    readonly serializeHandle: (
        handle: unknown,
        context: ResourceProjectionContext<ResourceMap>
    ) => ResourceProjectionPayload;
};

type ConsumerResource = AnyResourceDefinition & {
    readonly deserializeHandle: ProjectedResourceDefinition['deserializeHandle'];
};
function hasConsumerProjection(resource: AnyResourceDefinition): resource is ConsumerResource {
    return typeof resource.deserializeHandle === 'function';
}

function resourceHasProjection(resource: AnyResourceDefinition): resource is ProjectedResourceDefinition {
    return typeof resource.serializeHandle === 'function' &&
        typeof resource.deserializeHandle === 'function';
}

export function deserializeProjectedHandle(
    resource: AnyResourceDefinition,
    payload: ResourceProjectionPayload,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    const resolved = resourceReferenceCallbacks(resource);
    if (!hasConsumerProjection(resolved)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" requires a projection for worker-pool per-run ownership.`,
            resource
        );
    }

    return resolved.deserializeHandle(snapshotPortableValue(payload), {
        attachments: resourceAttachments(resource.name),
        dependencies: dependencyContext
    });
}

export function serializeProjectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): SerializedProjection | null {
    const resolved = resourceReferenceCallbacks(resource);
    if (!resourceHasProjection(resolved)) {
        return null;
    }

    const context = { attachments: resourceAttachments(resource.name), dependencies: dependencyContext };
    const payload = resolved.serializeHandle(ownerHandle, context);

    try {
        return { payload: snapshotPortableValue(payload) };
    } catch (error: unknown) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" returned a non-JSON projection payload.`,
            error
        );
    }
}

export function projectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    const payload = serializeProjectedHandle(resource, ownerHandle, dependencyContext);

    return payload === null
        ? ownerHandle
        : deserializeProjectedHandle(resource, payload.payload, dependencyContext);
}
