import { AsyncLocalStorage } from 'node:async_hooks';

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
type ObservedCase<Value> = {
    readonly baseline: readonly string[];
    readonly result: Value;
};

const activeResourceOwners = new AsyncLocalStorage<ResourceOwnerBaseline>();

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

export async function observeResourceOwnerAcquisition<Value>(
    create: () => Promise<Value>
): Promise<ObservedResourceAcquisition<Value>> {
    const observation = activeResourceOwners.getStore();
    const before = Array.from(observation?.read() ?? []);
    const value = await create();
    const resources = newResourceTypes(before, observation?.read() ?? []);
    if (observation !== undefined) {
        observation.append(resources);
    }
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
    return { result, baseline: observation.baseline() };
}
