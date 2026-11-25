import { registerModuleHooks } from './module-hook-registration.ts';
import { createModuleLoading } from './module-delivery.ts';

const moduleLoading = createModuleLoading({
    root: globalThis,
    register: registerModuleHooks,
    resolve: import.meta.resolve,
    async load(url) {
        const namespace: unknown = await import(url);
        return namespace;
    }
});

export const { withModuleLoadingScope, resolveModuleUrl, withModuleDelivery, isDeliveredModuleImport } = moduleLoading;
