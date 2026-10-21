import { currentAttemptIdentity, observingInfrastructure } from './execution-observation.ts';

type NativeResourceOwnership = {
    readonly kind: 'infrastructure';
    readonly confirmed: boolean;
} | {
    readonly kind: 'test';
    readonly attempt: symbol | null;
};

type NativeResource = {
    readonly type: string;
    readonly active: () => boolean;
    readonly ownership: NativeResourceOwnership;
};

type NativeResourceSnapshot = {
    readonly active: readonly string[];
    readonly uncertain: readonly string[];
};

const unreferencedResourceTypes = new Set([ 'PROMISE', 'TickObject', 'Microtask' ]);
const resources = new Map<number, NativeResource>();

type ReferencedTimer = { readonly hasRef: () => unknown; };

function isReferencedTimer(value: unknown): value is ReferencedTimer {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'hasRef') === 'function';
}

function referencedTimer(reference: WeakRef<ReferencedTimer>): boolean {
    return reference.deref()?.hasRef() === true;
}

export function recordNativeResource(id: number, type: string, resource: unknown): void {
    if (unreferencedResourceTypes.has(type)) {
        return;
    }
    if (type === 'Timeout' && isReferencedTimer(resource)) {
        const reference = new WeakRef(resource);
        resources.set(id, {
            type,
            ownership: observingInfrastructure()
                ? { kind: 'infrastructure', confirmed: true }
                : { kind: 'test', attempt: currentAttemptIdentity() },
            active() {
                return referencedTimer(reference);
            }
        });
        return;
    }
    resources.set(id, {
        type,
        ownership: observingInfrastructure()
            ? { kind: 'infrastructure', confirmed: false }
            : { kind: 'test', attempt: currentAttemptIdentity() },
        active() {
            return true;
        }
    });
}

export function forgetNativeResource(id: number): void {
    resources.delete(id);
}

export function clearNativeResources(): void {
    resources.clear();
}

function resourceAttribution(resource: NativeResource, attempt: symbol | null): 'active' | 'uncertain' | null {
    if (resource.ownership.kind === 'infrastructure') {
        return resource.ownership.confirmed ? 'active' : 'uncertain';
    }
    return attempt === null || resource.ownership.attempt !== attempt ? 'uncertain' : null;
}

export function observeNativeResources(): () => NativeResourceSnapshot {
    const before = new Set(resources.keys());
    const attempt = currentAttemptIdentity();
    return function nativeResourceSnapshot() {
        const active: string[] = [];
        const uncertain: string[] = [];
        const allocated = Array.from(resources).filter(function newActiveResource([ id, resource ]) {
            return !before.has(id) && resource.active();
        });
        for (const [ , resource ] of allocated) {
            const attribution = resourceAttribution(resource, attempt);
            if (attribution !== null) {
                (attribution === 'active' ? active : uncertain).push(resource.type);
            }
        }
        return { active, uncertain };
    };
}

export function sameNativeResourceType(resourceType: string, provider: string): boolean {
    return resourceType.replace('Socket', '').toUpperCase() === provider.toUpperCase();
}
