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

function isProjectionScalar(value: unknown): value is ResourceProjectionPayload {
    return value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number' && Number.isFinite(value);
}

function isProjectionObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectionPayload(value: unknown): value is ResourceProjectionPayload {
    if (isProjectionScalar(value)) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every(isProjectionPayload);
    }

    return isProjectionObject(value) &&
        Object.values(value).every(isProjectionPayload);
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
    if (!resourceHasProjection(resource)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" requires a projection for worker-pool per-run ownership.`,
            resource
        );
    }

    return resource.deserializeHandle(payload, {
        attachments: resourceAttachments(resource.name),
        dependencies: dependencyContext
    });
}

export function serializeProjectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): ResourceProjectionPayload | null {
    if (!resourceHasProjection(resource)) {
        return null;
    }

    const context = { attachments: resourceAttachments(resource.name), dependencies: dependencyContext };
    const payload = resource.serializeHandle(ownerHandle, context);

    if (!isProjectionPayload(payload)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" returned a non-JSON projection payload.`,
            payload
        );
    }

    return payload;
}

export function projectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    const payload = serializeProjectedHandle(resource, ownerHandle, dependencyContext);

    return payload === null
        ? ownerHandle
        : deserializeProjectedHandle(resource, payload, dependencyContext);
}
