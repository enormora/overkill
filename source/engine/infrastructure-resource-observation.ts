import { observingInfrastructure } from './execution-observation.ts';

type InfrastructureResource = {
    readonly type: string;
    readonly active: () => boolean;
    readonly confirmed: boolean;
};

type InfrastructureResourceSnapshot = {
    readonly active: readonly string[];
    readonly uncertain: readonly string[];
};

const unreferencedResourceTypes = new Set([ 'PROMISE', 'TickObject', 'Microtask' ]);
const resources = new Map<number, InfrastructureResource>();

type ReferencedTimer = { readonly hasRef: () => unknown; };

function isReferencedTimer(value: unknown): value is ReferencedTimer {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'hasRef') === 'function';
}

function referencedTimer(reference: WeakRef<ReferencedTimer>): boolean {
    return reference.deref()?.hasRef() === true;
}

export function recordInfrastructureResource(id: number, type: string, resource: unknown): void {
    if (!observingInfrastructure() || unreferencedResourceTypes.has(type)) {
        return;
    }
    if (type === 'Timeout' && isReferencedTimer(resource)) {
        const reference = new WeakRef(resource);
        resources.set(id, {
            type,
            confirmed: true,
            active() {
                return referencedTimer(reference);
            }
        });
        return;
    }
    resources.set(id, {
        type,
        confirmed: false,
        active() {
            return true;
        }
    });
}

export function forgetInfrastructureResource(id: number): void {
    resources.delete(id);
}

export function clearInfrastructureResources(): void {
    resources.clear();
}

export function observeInfrastructureResources(): () => InfrastructureResourceSnapshot {
    const before = new Set(resources.keys());
    return function infrastructureResourceSnapshot() {
        const active: string[] = [];
        const uncertain: string[] = [];
        for (const [ id, resource ] of resources) {
            if (!before.has(id) && resource.active()) {
                (resource.confirmed ? active : uncertain).push(resource.type);
            }
        }
        return { active, uncertain };
    };
}

export function sameNativeResourceType(resourceType: string, provider: string): boolean {
    return resourceType.replace('Socket', '').toUpperCase() === provider.toUpperCase();
}
