import {
    isRuntimeCapabilityPolicyEnvironment,
    isWebStorageLike,
    type RuntimeCapabilityPolicyEnvironment,
    type WebStorageLike
} from './capability-policy.ts';

export function readProcessEnvironment(processObject: Readonly<typeof process>): RuntimeCapabilityPolicyEnvironment {
    const environment: unknown = Reflect.get(processObject, 'env');

    return isRuntimeCapabilityPolicyEnvironment(environment) ? environment : {};
}

export function readWebStorage(
    host: Readonly<typeof globalThis>,
    name: 'localStorage' | 'sessionStorage'
): WebStorageLike | null {
    if (name === 'localStorage') {
        return null;
    }

    const storage: unknown = Reflect.get(host, name);

    return isWebStorageLike(storage) ? storage : null;
}
