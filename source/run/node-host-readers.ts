import {
    isRuntimeCapabilityPolicyEnvironment,
    isWebStorageLike,
    type RuntimeCapabilityPolicyEnvironment,
    type WebStorageLike
} from './capability-policy.ts';

type ProcessEnvironmentHost = {
    readonly env?: unknown;
};

type WebStorageHost = {
    readonly localStorage?: unknown;
    readonly sessionStorage?: unknown;
};

export function readProcessEnvironment(processObject: ProcessEnvironmentHost): RuntimeCapabilityPolicyEnvironment {
    const environment: unknown = Reflect.get(processObject, 'env');

    return isRuntimeCapabilityPolicyEnvironment(environment) ? environment : {};
}

export function readWebStorage(
    host: WebStorageHost,
    name: 'localStorage' | 'sessionStorage'
): WebStorageLike | null {
    if (name === 'localStorage') {
        return null;
    }

    const storage: unknown = Reflect.get(host, name);

    return isWebStorageLike(storage) ? storage : null;
}
