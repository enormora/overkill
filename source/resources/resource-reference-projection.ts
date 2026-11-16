import { resourceAttachments } from '../attachments/attachment-context.ts';
import { snapshotPortableValue } from '../portable-value.ts';
import type { AnyResourceDefinition, ResourceDependencies } from './resource-definition-shape.ts';
import type { ResourceContext } from './resource-definition-types.ts';
import { hasResourceImplementation } from './resource-reference.ts';
import { resourceReferenceCallbacks } from './resource-reference-binding.ts';

export function projectReferencedResourceHandle(
    resource: AnyResourceDefinition,
    handle: unknown,
    dependencies: ResourceContext<ResourceDependencies>
): unknown {
    if (!hasResourceImplementation(resource) || resource.implementation.consumer === null) {
        return handle;
    }
    const { serializeHandle, deserializeHandle } = resourceReferenceCallbacks(resource);
    if (serializeHandle === undefined || deserializeHandle === undefined) {
        throw new TypeError(`Resource "${resource.name}" requires admitted projection callbacks.`);
    }
    const context = { attachments: resourceAttachments(resource.name), dependencies };
    const payload: unknown = Reflect.apply(serializeHandle, undefined, [ handle, context ]);
    const consumer: unknown = Reflect.apply(deserializeHandle, undefined, [ snapshotPortableValue(payload), context ]);
    return consumer;
}
