// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Synchronous hooks are supported on the pinned Node version.
import { registerHooks } from 'node:module';
import { createModuleLoading } from './module-delivery.ts';

const moduleLoading = createModuleLoading({
    root: globalThis,
    register: registerHooks,
    resolve: import.meta.resolve,
    async load(url) {
        const namespace: unknown = await import(url);
        return namespace;
    }
});

export const { withModuleLoadingScope, resolveModuleUrl, withModuleDelivery, isDeliveredModuleImport } = moduleLoading;
