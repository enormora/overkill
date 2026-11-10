// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Synchronous hooks are supported on the pinned Node version.
import { registerHooks } from 'node:module';

export type ModuleLoadingHooks = {
    readonly load: NonNullable<Parameters<typeof registerHooks>[0]['load']>;
    readonly resolve: NonNullable<Parameters<typeof registerHooks>[0]['resolve']>;
};

export async function withModuleLoadingScope<Value>(
    hooks: ModuleLoadingHooks,
    operation: () => Promise<Value>
): Promise<Value> {
    const registration = registerHooks(hooks);
    try {
        return await operation();
    } finally {
        registration.deregister();
    }
}
