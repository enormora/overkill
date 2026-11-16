import { AsyncLocalStorage } from 'node:async_hooks';
import type {
    AnyResourceDefinition,
    ResourceConsumerBinding,
    ResourceOwnerBinding
} from './resource-definition-shape.ts';
import { withWorkloadCallbacks } from './resource-workload-callbacks.ts';

type OwnerCallbacks = ReturnType<ResourceOwnerBinding['bind']>;
type ConsumerCallbacks = ReturnType<ResourceConsumerBinding['bind']>;
type AdmittedResource = AnyResourceDefinition & { readonly acquire: (context: never) => unknown; };
const owners = new AsyncLocalStorage<ReadonlyMap<ResourceOwnerBinding, OwnerCallbacks>>();
const consumers = new AsyncLocalStorage<ReadonlyMap<ResourceConsumerBinding, ConsumerCallbacks>>();

function admittedOwner(owner: ResourceOwnerBinding, name: string): OwnerCallbacks {
    const callbacks = owners.getStore()?.get(owner);
    if (callbacks === undefined) {
        throw new TypeError(`Resource "${name}" requires prepared implementation admission.`);
    }
    return callbacks;
}

function admittedConsumer(consumer: ResourceConsumerBinding | null, name: string): ConsumerCallbacks | null {
    if (consumer === null) {
        return null;
    }
    const callbacks = consumers.getStore()?.get(consumer);
    if (callbacks === undefined) {
        throw new TypeError(`Resource "${name}" requires prepared implementation admission.`);
    }
    return callbacks;
}

export function resourceReferenceCallbacks(resource: AnyResourceDefinition): AdmittedResource {
    if (resource.acquire !== null) {
        return resource;
    }
    const { implementation } = resource;
    const owner = owners.getStore()?.get(implementation.owner);
    const { serializeHandle, ...callbacks } = owner ??
        {
            serializeHandle: null,
            dispose: null,
            exposeHandle: null,
            acquire(context: Parameters<OwnerCallbacks['acquire']>[0]) {
                return admittedOwner(implementation.owner, resource.name).acquire(context);
            }
        };
    const resolved = {
        ...resource,
        ...callbacks,
        ...serializeHandle === null ? {} : { serializeHandle },
        ...admittedConsumer(implementation.consumer, resource.name)
    };
    return implementation.workload === null ? resolved : withWorkloadCallbacks(resolved, implementation.workload);
}

export async function withResourceOwner<Value>(
    owner: ResourceOwnerBinding,
    callbacks: OwnerCallbacks,
    operation: () => Promise<Value>
): Promise<Value> {
    const bindings = new Map(owners.getStore());
    bindings.set(owner, callbacks);
    return await owners.run(bindings, operation);
}

export async function withResourceConsumer<Value>(
    consumer: ResourceConsumerBinding,
    callbacks: ConsumerCallbacks,
    operation: () => Promise<Value>
): Promise<Value> {
    const bindings = new Map(consumers.getStore());
    bindings.set(consumer, callbacks);
    return await consumers.run(bindings, operation);
}
