import asyncHooks, { AsyncLocalStorage, type AsyncHook } from 'node:async_hooks';
import { createStoredValue } from '../stored-value.ts';
import { registerExecutionDisposal } from './execution-observation.ts';
import {
    recordNativeResource,
    completeNativeWriteRequest,
    forgetNativeResource,
    clearNativeResources,
    observeNativeResources,
    sameNativeResourceType
} from './native-resource-observation.ts';

export type ResourceOwnerObservation = {
    readonly resources: readonly string[];
};
type ResourceOwnerBaseline = {
    readonly read: () => readonly string[];
    readonly append: (types: readonly string[]) => void;
    readonly remove: (types: readonly string[]) => void;
    readonly baseline: () => readonly string[];
};
type ObservedResourceAcquisition<Value> = {
    readonly owner: ResourceOwnerObservation;
    readonly value: Value;
};
export type ObservedCase<Value> = {
    readonly ambiguousResources: readonly string[];
    readonly baseline: readonly string[];
    readonly result: Value;
};

const activeResourceOwners = new AsyncLocalStorage<ResourceOwnerBaseline>();
const activeAcquisition = new AsyncLocalStorage<symbol>();
type ResourceAcquisition = {
    readonly owner: symbol;
    readonly record: (type: string) => void;
    readonly owns: (type: string) => boolean;
};
const acquisitions = new Set<ResourceAcquisition>();

function createResourceAcquisition(): ResourceAcquisition {
    const owner = Symbol('resource acquisition');
    const allocations = new Set<string>();
    const ownedAllocations = new Map<string, number>();
    return {
        owner,
        record(type) {
            allocations.add(type);
            if (activeAcquisition.getStore() === owner) {
                ownedAllocations.set(type, (ownedAllocations.get(type) ?? 0) + 1);
            }
        },
        owns(type) {
            const provider = type.replace('Socket', '').toUpperCase();
            if (!allocations.has(provider)) {
                return true;
            }
            const count = ownedAllocations.get(provider) ?? 0;
            ownedAllocations.set(provider, Math.max(0, count - 1));
            return count > 0;
        }
    };
}

function recordResourceOwnerAllocation(type: string): void {
    for (const acquisition of acquisitions) {
        acquisition.record(type);
    }
}

const allocationObservers = new Set<symbol>();
const allocationHook = createStoredValue<AsyncHook | null>(null);

export function observeResourceOwnerAllocations(): () => void {
    const observer = Symbol('resource allocation observer');
    allocationObservers.add(observer);
    if (allocationHook.read() === null) {
        const createHookKey = 'createHook';
        const hook = asyncHooks[createHookKey]({
            init(id, type, _trigger, resource: unknown) {
                recordResourceOwnerAllocation(type);
                recordNativeResource(id, type, resource);
            },
            before(id) {
                completeNativeWriteRequest(id);
            },
            destroy(id) {
                forgetNativeResource(id);
            }
        });
        hook.enable();
        allocationHook.write(hook);
    }
    return function stopResourceOwnerAllocations() {
        allocationObservers.delete(observer);
        if (allocationObservers.size === 0) {
            allocationHook.read()?.disable();
            allocationHook.write(null);
            clearNativeResources();
        }
    };
}

function newResourceTypes(before: readonly string[], after: readonly string[]): readonly string[] {
    const remaining = new Map<string, number>();
    for (const type of before) {
        remaining.set(type, (remaining.get(type) ?? 0) + 1);
    }
    return after.filter(function newlyAllocated(type) {
        const count = remaining.get(type) ?? 0;
        remaining.set(type, Math.max(0, count - 1));
        return count === 0;
    });
}

async function acquiredResourceTypes<Value>(
    read: () => readonly string[],
    create: () => Promise<Value>
): Promise<{ readonly value: Value; readonly resources: readonly string[]; }> {
    const acquisition = createResourceAcquisition();
    const before = Array.from(read());
    acquisitions.add(acquisition);
    const unregister = registerExecutionDisposal(function stopAcquisitionObservation() {
        acquisitions.delete(acquisition);
    });
    try {
        const value = await activeAcquisition.run(acquisition.owner, create);
        return { value, resources: newResourceTypes(before, read()).filter(acquisition.owns) };
    } finally {
        unregister();
        acquisitions.delete(acquisition);
    }
}

export async function observeResourceOwnerAcquisition<Value>(
    create: () => Promise<Value>
): Promise<ObservedResourceAcquisition<Value>> {
    const observation = activeResourceOwners.getStore();
    if (observation === undefined) {
        return { value: await create(), owner: { resources: [] } };
    }
    const { value, resources } = await acquiredResourceTypes(observation.read, create);
    observation.append(resources);
    return { value, owner: { resources } };
}

export function releaseResourceOwner(owner: ResourceOwnerObservation): void {
    const observation = activeResourceOwners.getStore();
    if (observation === undefined) {
        return;
    }
    observation.remove(owner.resources);
}

export async function observeCaseResourceOwners<Value>(
    read: () => readonly string[],
    run: () => Promise<Value>
): Promise<ObservedCase<Value>> {
    const resources = Array.from(read());
    const nativeResources = observeNativeResources();
    const observation: ResourceOwnerBaseline = {
        read,
        append(types) {
            resources.push(...types);
        },
        remove(types) {
            for (const type of types) {
                const index = resources.indexOf(type);
                if (index !== -1) {
                    resources.splice(index, 1);
                }
            }
        },
        baseline() {
            return Array.from(resources);
        }
    };
    const result = await activeResourceOwners.run(observation, run);
    return {
        result,
        get baseline() {
            return [ ...observation.baseline(), ...nativeResources().active ];
        },
        get ambiguousResources() {
            const growth = newResourceTypes(observation.baseline(), read());
            return growth.filter(function uncertainOwnership(type) {
                return nativeResources().uncertain.some(function matchingProvider(provider) {
                    return sameNativeResourceType(type, provider);
                });
            });
        }
    };
}
