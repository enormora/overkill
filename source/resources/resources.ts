const resourceDefinitionBrand: unique symbol = Symbol('overkill.resourceDefinition');
const runtimeDefinitionBrand: unique symbol = Symbol('overkill.runtimeDefinition');

export type Awaitable<Value> = Promise<Value> | Value;
type ExclusiveResource = { readonly kind: 'exclusive-resource'; readonly name: string; };
type SerialExecution = { readonly kind: 'serial'; };
type SingleWorkerExecution = { readonly kind: 'single-worker'; };
type StartupBudget = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};

export type AnyResourceDefinition = {
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dependencies: ResourceDependencies;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly name: string;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly [resourceDefinitionBrand]: true;
};

export type RuntimeResourceMap = Readonly<Record<string, AnyResourceDefinition>>;
export type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;

export type RuntimeDimensions = Readonly<Record<string, string>>;

export type RuntimeId<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions
> = {
    readonly name: Name;
    readonly dimensions: Dimensions;
};

export type ExecutionRequirement = ExclusiveResource | SerialExecution | SingleWorkerExecution | StartupBudget;

export type ResourceScope = 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';

export type ResourceDependencies = Readonly<Record<string, AnyResourceDefinition>>;

export type ResourceHandle<Resource extends AnyResourceDefinition> = Awaited<ReturnType<Resource['acquire']>>;

export type ResourceContext<Resources extends ResourceDependencies> = {
    readonly [Key in keyof Resources]: ResourceHandle<Resources[Key]>;
};

export type ResourceCreationContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
};

export type ResourceDisposalContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
};

export type ResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = {
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<Handle>;
    readonly dependencies?: Dependencies;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
};

export type ResourceDefinition<
    Name extends string = string,
    Handle = unknown,
    Dependencies extends ResourceDependencies = ResourceDependencies
> = {
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<Handle>;
    readonly dependencies: Dependencies;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly [resourceDefinitionBrand]: true;
};

export type RuntimeDefinitionInput<
    Name extends string,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = {
    readonly dimensions: Dimensions;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly resources: Resources;
};

export type RuntimeDefinition<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions,
    Resources extends RuntimeResourceMap = RuntimeResourceMap
> = RuntimeDefinitionInput<Name, Dimensions, Resources> & {
    readonly id: RuntimeId<Name, Dimensions>;
    readonly [runtimeDefinitionBrand]: true;
};

export type RuntimeContext<Runtime extends RuntimeDefinition> = {
    readonly [Key in keyof Runtime['resources']]: ResourceHandle<Runtime['resources'][Key]>;
};

export type RuntimeScopeContext<Runtime extends RuntimeDefinition> = Readonly<
    Record<Runtime['name'], RuntimeContext<Runtime>>
>;

type EmptyRuntimeScopes = Pick<Readonly<Record<string, never>>, never>;
type RuntimeScopeKey<Runtime extends RuntimeDefinition> = Runtime['name'];
type RuntimeScopes<Context> = Context extends {
    readonly runtimes: infer Runtimes extends Readonly<Record<string, unknown>>;
} ? Runtimes
    : EmptyRuntimeScopes;

type RuntimeScopeGuard<
    Context,
    Runtime extends RuntimeDefinition
> = RuntimeScopeKey<Runtime> extends keyof RuntimeScopes<Context> ? never : unknown;
type RuntimeScopeBaseContext<Context> = {
    readonly [Key in keyof Context as Key extends 'runtimes' ? never : Key]: Context[Key];
};
type ComposedRuntimeScopes<BaseContext, Runtime extends RuntimeDefinition> = {
    readonly runtimes: RuntimeScopeContext<Runtime> & RuntimeScopes<BaseContext>;
};

export type RuntimeContextComposition<BaseContext, Runtime extends RuntimeDefinition> = Readonly<
    ComposedRuntimeScopes<BaseContext, Runtime> & RuntimeScopeBaseContext<BaseContext>
>;

export type TemporaryDirectoryHandle = {
    readonly path: string;
};

export type ResourcesModuleDependencies = {
    readonly createTemporaryDirectory: (pathPrefix: string) => Awaitable<string>;
    readonly removeDirectory: (path: string) => Awaitable<void>;
    readonly temporaryDirectoryPathPrefix: string;
};

type CreateTemporaryDirectoryResource = <const Name extends string>(
    name: Name
) => ResourceDefinition<Name, TemporaryDirectoryHandle, EmptyResourceDependencies>;

export type ResourcesModule = {
    readonly composeRuntimeContext: typeof composeRuntimeContext;
    readonly createTemporaryDirectoryResource: CreateTemporaryDirectoryResource;
    readonly defineResource: typeof defineResource;
    readonly defineRuntime: typeof defineRuntime;
};

export function defineResource<const Name extends string, Handle>(
    definition: ResourceDefinitionInput<Name, Handle>
): ResourceDefinition<Name, Handle, EmptyResourceDependencies>;
export function defineResource<const Name extends string, Handle, const Dependencies extends ResourceDependencies>(
    definition: ResourceDefinitionInput<Name, Handle, Dependencies> & {
        readonly dependencies: Dependencies;
    }
): ResourceDefinition<Name, Handle, Dependencies>;
export function defineResource<const Name extends string, Handle, const Dependencies extends ResourceDependencies>(
    definition: ResourceDefinitionInput<Name, Handle, Dependencies>
): ResourceDefinition<Name, Handle, Dependencies | EmptyResourceDependencies> {
    if (definition.dependencies === undefined) {
        const dependencies = Object.freeze({});

        return Object.freeze({
            ...definition,
            dependencies,
            [resourceDefinitionBrand]: true as const
        });
    }

    return Object.freeze({
        ...definition,
        dependencies: Object.freeze(definition.dependencies),
        [resourceDefinitionBrand]: true as const
    });
}

function createTemporaryDirectoryResource<const Name extends string>(
    dependencies: ResourcesModuleDependencies,
    name: Name
): ResourceDefinition<Name, TemporaryDirectoryHandle, EmptyResourceDependencies> {
    return defineResource({
        name,
        scope: 'per-case',
        requirements: [],
        async acquire(context) {
            context.signal.throwIfAborted();

            return Object.freeze({
                path: await dependencies.createTemporaryDirectory(dependencies.temporaryDirectoryPathPrefix)
            });
        },
        async dispose(handle) {
            await dependencies.removeDirectory(handle.path);
        }
    });
}

export function defineRuntime<
    const Name extends string,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap
>(
    definition: RuntimeDefinitionInput<Name, Dimensions, Resources>
): RuntimeDefinition<Name, Dimensions, Resources> {
    return Object.freeze({
        ...definition,
        id: Object.freeze({
            name: definition.name,
            dimensions: definition.dimensions
        }),
        [runtimeDefinitionBrand]: true as const
    });
}

function assertRuntimeScopes<Context>(runtimes: unknown): asserts runtimes is RuntimeScopes<Context> {
    if (typeof runtimes !== 'object' || runtimes === null || Array.isArray(runtimes)) {
        throw new TypeError('composeRuntimeContext() requires context.runtimes to be an object when present.');
    }
}

function assertRuntimeScopeContext<Runtime extends RuntimeDefinition>(
    runtimes: Readonly<Record<string, unknown>>,
    runtime: Runtime
): asserts runtimes is RuntimeScopeContext<Runtime> {
    if (!Object.hasOwn(runtimes, runtime.name)) {
        throw new TypeError(`Runtime scope "${runtime.name}" was not composed.`);
    }
}

function assertRuntimeContextComposition<BaseContext, Runtime extends RuntimeDefinition>(
    composition: unknown
): asserts composition is RuntimeContextComposition<BaseContext, Runtime> {
    if (typeof composition !== 'object' || composition === null) {
        throw new TypeError('composeRuntimeContext() created an invalid context.');
    }
}

function composeRuntimeContext<
    BaseContext extends Readonly<Record<string, unknown>>,
    Runtime extends RuntimeDefinition
>(
    context: BaseContext & RuntimeScopeGuard<BaseContext, Runtime>,
    runtime: Runtime,
    resourceHandles: RuntimeContext<Runtime>
): RuntimeContextComposition<BaseContext, Runtime> {
    const runtimes: unknown = Object.hasOwn(context, 'runtimes') ? Reflect.get(context, 'runtimes') : {};

    assertRuntimeScopes<BaseContext>(runtimes);

    if (Object.hasOwn(runtimes, runtime.name)) {
        throw new TypeError(`Runtime scope "${runtime.name}" already exists.`);
    }

    const runtimeScopes = Object.freeze({
        ...runtimes,
        [runtime.name]: resourceHandles
    });
    assertRuntimeScopeContext(runtimeScopes, runtime);
    const baseContext: BaseContext = context;

    const composition: unknown = Object.freeze({
        ...baseContext,
        runtimes: runtimeScopes
    });

    assertRuntimeContextComposition<BaseContext, Runtime>(composition);

    return composition;
}

export function createResourcesModule(dependencies: ResourcesModuleDependencies): ResourcesModule {
    return Object.freeze({
        composeRuntimeContext,
        createTemporaryDirectoryResource(name) {
            return createTemporaryDirectoryResource(dependencies, name);
        },
        defineResource,
        defineRuntime
    });
}

export function isDefinedResource(resource: unknown): resource is AnyResourceDefinition {
    return typeof resource === 'object' &&
        resource !== null &&
        Reflect.get(resource, resourceDefinitionBrand) === true;
}

export function isDefinedRuntime(runtime: unknown): runtime is RuntimeDefinition {
    return typeof runtime === 'object' &&
        runtime !== null &&
        Reflect.get(runtime, runtimeDefinitionBrand) === true;
}
