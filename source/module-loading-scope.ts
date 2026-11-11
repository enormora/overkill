// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Synchronous hooks are supported on the pinned Node version.
import { registerHooks } from 'node:module';

export type ModuleLoadingHooks = {
    readonly load: <Result>(url: string, nextLoad: () => Result) => Result;
    readonly resolve: <Result extends { readonly url: string; }>(
        specifier: string,
        parentURL: string | undefined,
        nextResolve: () => Result
    ) => Result;
};

export async function withModuleLoadingScope<Value>(
    hooks: ModuleLoadingHooks,
    operation: () => Promise<Value>
): Promise<Value> {
    const registration = registerHooks({
        resolve(specifier, context, nextResolve) {
            return hooks.resolve(specifier, context.parentURL, function () {
                return nextResolve(specifier, context);
            });
        },
        load(url, context, nextLoad) {
            return hooks.load(url, function () {
                return nextLoad(url, context);
            });
        }
    });
    try {
        return await operation();
    } finally {
        registration.deregister();
    }
}
