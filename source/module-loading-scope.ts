import { types } from 'node:util';
// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Synchronous hooks are supported on the pinned Node version.
import { registerHooks } from 'node:module';
import { ImplementationLoadError } from './implementation-load-error.ts';

const resolveNativeModule = import.meta.resolve;

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

export type DeliveredModule = {
    readonly url: string;
    readonly format: 'json' | 'module' | 'module-typescript';
    readonly source: string;
    readonly dependencies: Readonly<Record<string, string>>;
};

export function resolveModuleUrl(specifier: string, parentURL: string): string {
    const marker = `overkill:resolve/${encodeURIComponent(specifier)}`;
    const registration = registerHooks({
        resolve(request, context, nextResolve) {
            return request === marker
                ? nextResolve(specifier, { ...context, parentURL })
                : nextResolve(request, context);
        }
    });
    try {
        return resolveNativeModule(marker);
    } finally {
        registration.deregister();
    }
}

type ModuleDelivery = {
    readonly build: string;
    readonly modules: readonly DeliveredModule[];
    readonly builtins: readonly string[];
};

function buildUrl(url: string, build: string): string {
    const delivered = new URL(url);
    delivered.searchParams.set('overkill-build', build);
    return delivered.href;
}

function moduleBuildToken(url: string): string | null {
    const parsed = new URL(url);
    return parsed.searchParams.get('overkill-build');
}

function deliveryOwns(url: string | undefined, build: string): boolean {
    return url !== undefined && URL.parse(url)?.searchParams.get('overkill-build') === build;
}

function originalModuleUrl(url: string): string {
    const original = new URL(url);
    original.searchParams.delete('overkill-build');
    return original.href;
}

type ModuleDeliveryResolver = {
    readonly modules: ReadonlyMap<string, DeliveredModule>;
    readonly target: (specifier: string, parentURL: string | undefined) => string;
};

function declaredModuleTarget(
    modules: ReadonlyMap<string, DeliveredModule>,
    parent: string,
    specifier: string
): string | null {
    const module = modules.get(parent);
    if (module === undefined || !Object.hasOwn(module.dependencies, specifier)) {
        return null;
    }
    return module.dependencies[specifier] ?? null;
}

function moduleDeliveryResolver(delivery: ModuleDelivery): ModuleDeliveryResolver {
    const modules = new Map(delivery.modules.map(function entry(module) {
        return [ module.url, module ];
    }));
    function importedTarget(specifier: string, parentURL: string): string {
        const parent = originalModuleUrl(parentURL);
        const resolved = declaredModuleTarget(modules, parent, specifier) ?? resolveModuleUrl(specifier, parent);
        if (delivery.builtins.includes(resolved)) {
            return resolved;
        }
        const logical = deliveryOwns(resolved, delivery.build) ? originalModuleUrl(resolved) : resolved;
        if (!modules.has(logical)) {
            throw new TypeError(`Implementation import is outside the frozen graph: ${specifier}`);
        }
        return buildUrl(logical, delivery.build);
    }
    return {
        modules,
        target(specifier, parentURL) {
            return parentURL !== undefined && deliveryOwns(parentURL, delivery.build)
                ? importedTarget(specifier, parentURL)
                : specifier;
        }
    };
}

type DeliveryLease = { readonly token: string; readonly close: (pending: boolean) => void; };
type DeliveryRegistry = {
    readonly active: (url: string | undefined) => void;
    readonly admits: (url: string) => boolean;
    readonly open: (build: string) => DeliveryLease;
};
const registryKey = Symbol.for('@overkill-dev/NativeDeliveryRegistry');
function hasRegistry(value: Record<string, unknown>): value is { readonly [registryKey]: DeliveryRegistry; } {
    return Object.hasOwn(value, registryKey);
}
function createDeliveryRegistry(): DeliveryRegistry {
    const active = new Map<string, number>();
    const generations = new Map<string, number>();
    return {
        admits(url) {
            const parsed = new URL(url);
            const token = parsed.searchParams.get('overkill-build');
            return token !== null && active.has(token);
        },
        active(url) {
            if (url === undefined) {
                return;
            }
            const token = moduleBuildToken(url);
            if (token !== null && !active.has(token)) {
                throw new ImplementationLoadError('Implementation delivery is closed.', { cause: null });
            }
        },
        open(build) {
            const generation = generations.get(build) ?? 0;
            const token = `${build}:${generation}`;
            active.set(token, (active.get(token) ?? 0) + 1);
            return {
                token,
                close(pending) {
                    const remaining = (active.get(token) ?? 1) - 1;
                    if (remaining > 0) {
                        active.set(token, remaining);
                        return;
                    }
                    active.delete(token);
                    if (pending) {
                        generations.set(build, generation + 1);
                    }
                }
            };
        }
    };
}
function deliveryRegistry(): DeliveryRegistry {
    const root: Record<string, unknown> = globalThis;
    if (hasRegistry(root)) {
        return root[registryKey];
    }
    const registry = createDeliveryRegistry();
    registerHooks({
        resolve(specifier, context, nextResolve) {
            registry.active(context.parentURL);
            const resolved = nextResolve(specifier, context);
            registry.active(resolved.url);
            return resolved;
        },
        load(url, context, nextLoad) {
            registry.active(url);
            return nextLoad(url, context);
        }
    });
    Object.defineProperty(globalThis, registryKey, { value: registry });
    return registry;
}
type DeliveredSource = Pick<DeliveredModule, 'format' | 'source'> & { readonly shortCircuit: true; };
function namespaceSource(url: string, resolver: ModuleDeliveryResolver): DeliveredSource {
    const requested = new URL(url);
    requested.searchParams.delete('overkill-namespace');
    const target = requested.href;
    const module = resolver.modules.get(originalModuleUrl(target));
    if (module === undefined) {
        throw new TypeError('Implementation namespace is outside the frozen graph.');
    }
    const attributes = module.format === 'json' ? ' with {type: "json"}' : '';
    return {
        source: `import * as namespace from ${JSON.stringify(target)}${attributes}; export {namespace};`,
        format: 'module',
        shortCircuit: true
    };
}
function deliveredSource(url: string, resolver: ModuleDeliveryResolver): DeliveredSource {
    const parsed = new URL(url);
    if (parsed.searchParams.has('overkill-namespace')) {
        return namespaceSource(url, resolver);
    }
    const module = resolver.modules.get(originalModuleUrl(url));
    if (module === undefined) {
        throw new TypeError('Implementation module is outside the frozen graph.');
    }
    return { source: module.source, format: module.format, shortCircuit: true };
}
type DeliveryFailures = { readonly record: (error: unknown) => never; readonly check: () => void; };
function deliveryFailures(): DeliveryFailures {
    const faults: unknown[] = [];
    return {
        record(error) {
            const failure = new ImplementationLoadError(
                error instanceof Error ? error.message : 'Implementation loading failed.',
                { cause: error }
            );
            faults.push(failure);
            throw failure;
        },
        check() {
            if (faults.length > 0) {
                throw new AggregateError(faults, 'Implementation loading failed.');
            }
        }
    };
}
function verifiedResolution<Result extends { readonly url: string; }>(target: string, resolved: Result): Result {
    if (resolved.url !== target) {
        throw new TypeError('Implementation module resolution changed after preparation.');
    }
    return resolved;
}
function registerDelivery(
    resolver: ModuleDeliveryResolver,
    token: string,
    failures: DeliveryFailures
): ReturnType<typeof registerHooks> {
    return registerHooks({
        resolve(specifier, context, nextResolve) {
            if (!deliveryOwns(specifier, token) && !deliveryOwns(context.parentURL, token)) {
                return nextResolve(specifier, context);
            }
            try {
                const target = resolver.target(specifier, context.parentURL);
                const resolved = verifiedResolution(target, nextResolve(target, context));
                return { ...resolved, shortCircuit: true };
            } catch (error: unknown) {
                return failures.record(error);
            }
        },
        load(url, context, nextLoad) {
            if (!deliveryOwns(url, token)) {
                return nextLoad(url, context);
            }
            try {
                return deliveredSource(url, resolver);
            } catch (error: unknown) {
                return failures.record(error);
            }
        }
    });
}
type ModuleNamespace = { readonly namespace: unknown; };
type DeliveryLoader = { readonly load: (url: string) => Promise<ModuleNamespace>; readonly pending: () => boolean; };
function readModuleNamespace(value: unknown): ModuleNamespace {
    const namespace: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'namespace') : null;
    if (!types.isModuleNamespaceObject(namespace)) {
        throw new TypeError('Implementation modules must produce an ES module namespace.');
    }
    return { namespace };
}
function deliveryLoader(resolver: ModuleDeliveryResolver, token: string): DeliveryLoader {
    let pending = 0;
    return {
        pending() {
            return pending > 0;
        },
        async load(url) {
            if (!resolver.modules.has(url)) {
                throw new TypeError('Implementation entry is outside the frozen graph.');
            }
            const facade = new URL(buildUrl(url, token));
            facade.searchParams.set('overkill-namespace', '1');
            pending += 1;
            try {
                return readModuleNamespace(await import(facade.href));
            } finally {
                pending -= 1;
            }
        }
    };
}

type ActiveDelivery = {
    readonly load: DeliveryLoader['load'];
    readonly check: () => void;
    readonly close: () => void;
};
function startModuleDelivery(delivery: ModuleDelivery): ActiveDelivery {
    const lease = deliveryRegistry().open(delivery.build);
    const resolver = moduleDeliveryResolver({ ...delivery, build: lease.token });
    const failures = deliveryFailures();
    const registration = registerDelivery(resolver, lease.token, failures);
    const loader = deliveryLoader(resolver, lease.token);
    return {
        load: loader.load,
        check: failures.check,
        close() {
            lease.close(loader.pending());
            registration.deregister();
        }
    };
}
export async function withModuleDelivery<Value>(
    delivery: ModuleDelivery,
    operation: (load: DeliveryLoader['load']) => Promise<Value>
): Promise<Value> {
    const active = startModuleDelivery(delivery);
    try {
        const result = await operation(active.load);
        active.check();
        return result;
    } finally {
        active.close();
    }
}

export function isDeliveredModuleImport(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const parentURL: unknown = Reflect.get(value, 'parentURL');
    const root: Record<string, unknown> = globalThis;
    return typeof parentURL === 'string' && hasRegistry(root) && root[registryKey].admits(parentURL);
}
