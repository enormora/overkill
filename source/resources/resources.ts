const resourceDefinitionBrand: unique symbol = Symbol('overkill.resourceDefinition');
const runtimeDefinitionBrand: unique symbol = Symbol('overkill.runtimeDefinition');

export type Awaitable<Value> = Promise<Value> | Value;
type ValueOf<Values> = Values[keyof Values];
type ExclusiveResource = { readonly kind: 'exclusive-resource'; readonly name: string; };
type SerialExecution = { readonly kind: 'serial'; };
type SingleWorkerExecution = { readonly kind: 'single-worker'; };
type StartupBudget = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};
type CapacityWeight = {
    readonly kind: 'capacity-weight';
    readonly weight: number;
};
type AffinityKey = {
    readonly key: string;
    readonly kind: 'affinity-key';
};
type FaultDomain = {
    readonly key: string;
    readonly kind: 'fault-domain';
};

export type AnyResourceDefinition = {
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dependencies: ResourceDependencies;
    readonly deserializeHandle?: (payload: never, context: never) => unknown;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly name: string;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly serializeHandle?: (handle: never, context: never) => ResourceProjectionPayload;
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

type PlacementRequirement = AffinityKey | CapacityWeight | ExclusiveResource | FaultDomain;
type SchedulingRequirement = SerialExecution | SingleWorkerExecution | StartupBudget;

export type ExecutionRequirement = PlacementRequirement | SchedulingRequirement;

export type ResourceScope = 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';

export type ResourceDependencies = Readonly<Record<string, AnyResourceDefinition>>;

type ResourceProjectionObject = { readonly [key: string]: ResourceProjectionPayload; };

type ResourceProjectionScalar = boolean | number | string | null;
type ResourceProjectionCollection = ResourceProjectionObject | readonly ResourceProjectionPayload[];

export type ResourceProjectionPayload = ResourceProjectionCollection | ResourceProjectionScalar;

export type ResourceProjectionContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly dependencies: ResourceContext<Dependencies>;
};

export type ResourceHandle<Resource extends AnyResourceDefinition> = Resource extends {
    readonly deserializeHandle?: ((payload: never, context: never) => infer ConsumerHandle) | undefined;
} ? ConsumerHandle
    : Awaited<ReturnType<Resource['acquire']>>;

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

type ResourceDefinitionBaseInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = {
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<Handle>;
    readonly dependencies?: Dependencies;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
};

type LocalOnlyResourceDefinitionInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = ResourceDefinitionBaseInput<Name, Handle, Scope, Dependencies> & {
    readonly deserializeHandle?: never;
    readonly serializeHandle?: never;
};

type ProjectedResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends 'per-file' | 'per-run' | 'per-suite',
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = ResourceDefinitionBaseInput<Name, OwnerHandle, Scope, Dependencies> & {
    readonly deserializeHandle: (
        payload: Projection,
        context: ResourceProjectionContext<Dependencies>
    ) => ConsumerHandle;
    readonly serializeHandle: (
        handle: OwnerHandle,
        context: ResourceProjectionContext<Dependencies>
    ) => Projection;
};

export type ResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Projection extends ResourceProjectionPayload = ResourceProjectionPayload,
    ConsumerHandle = Handle
> = ValueOf<ResourceDefinitionInputOptions<Name, Handle, Dependencies, Projection, ConsumerHandle>>;

type ResourceDefinitionInputOptions<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle
> = {
    readonly local: LocalResourceDefinitionInput<Name, Handle, Dependencies>;
    readonly projected: ProjectedResourceInput<
        Name,
        Handle,
        Projection,
        ConsumerHandle,
        Dependencies
    >;
};

type LocalResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies
> = LocalCaseResourceInput<Name, Handle, Dependencies> | LocalFileResourceInput<Name, Handle, Dependencies>;

type LocalCaseResourceInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies
> = LocalOnlyResourceDefinitionInput<Name, Handle, 'per-case' | 'shared-per-worker', Dependencies>;

type LocalFileResourceInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies
> = LocalOnlyResourceDefinitionInput<Name, Handle, 'per-file' | 'per-suite', Dependencies>;

type ProjectedResourceInput<
    Name extends string,
    Handle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Dependencies extends ResourceDependencies
> = ValueOf<ProjectedResourceInputOptions<Name, Handle, Projection, ConsumerHandle, Dependencies>>;

type ProjectedResourceInputOptions<
    Name extends string,
    Handle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly file: ProjectedFileResourceInput<Name, Handle, Projection, ConsumerHandle, Dependencies>;
    readonly run: ProjectedRunResourceInput<
        Name,
        Handle,
        Projection,
        ConsumerHandle,
        Dependencies
    >;
};

type ProjectedFileResourceInput<
    Name extends string,
    Handle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Dependencies extends ResourceDependencies
> = ProjectedResourceDefinitionInput<Name, Handle, Projection, ConsumerHandle, 'per-file' | 'per-suite', Dependencies>;

type ProjectedRunResourceInput<
    Name extends string,
    Handle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Dependencies extends ResourceDependencies
> = ProjectedResourceDefinitionInput<Name, Handle, Projection, ConsumerHandle, 'per-run', Dependencies>;

export type ResourceDefinition<
    Name extends string = string,
    OwnerHandle = unknown,
    Dependencies extends ResourceDependencies = ResourceDependencies,
    ConsumerHandle = OwnerHandle
> = {
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<OwnerHandle>;
    readonly dependencies: Dependencies;
    readonly deserializeHandle?: (
        payload: ResourceProjectionPayload,
        context: ResourceProjectionContext<Dependencies>
    ) => ConsumerHandle;
    readonly dispose: ((handle: OwnerHandle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly serializeHandle?: (
        handle: OwnerHandle,
        context: ResourceProjectionContext<Dependencies>
    ) => ResourceProjectionPayload;
    readonly [resourceDefinitionBrand]: true;
};

type ResourceOwnerHandle<Definition> = Definition extends {
    readonly acquire: (context: never) => Awaitable<infer Handle>;
} ? Handle
    : never;

type ResourceConsumerHandle<Definition> = Definition extends {
    readonly deserializeHandle: (payload: never, context: never) => infer Handle;
} ? Handle
    : ResourceOwnerHandle<Definition>;

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

export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>
>(
    definition: LocalOnlyResourceDefinitionInput<Name, Handle, Scope>
): ResourceDefinition<Name, Handle, EmptyResourceDependencies>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends 'per-file' | 'per-run' | 'per-suite'
>(
    definition: ProjectedResourceDefinitionInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope>
): ResourceDefinition<Name, OwnerHandle, EmptyResourceDependencies, ConsumerHandle>;
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies
>(
    definition: LocalOnlyResourceDefinitionInput<Name, Handle, Scope, Dependencies> & {
        readonly dependencies: Dependencies;
    }
): ResourceDefinition<Name, Handle, Dependencies>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends 'per-file' | 'per-run' | 'per-suite',
    const Dependencies extends ResourceDependencies
>(
    definition: ProjectedResourceDefinitionInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope, Dependencies> & {
        readonly dependencies: Dependencies;
    }
): ResourceDefinition<Name, OwnerHandle, Dependencies, ConsumerHandle>;
export function defineResource<
    const Name extends string,
    Handle,
    const Dependencies extends ResourceDependencies
>(
    definition: ResourceDefinitionInput<Name, Handle, Dependencies>
): ResourceDefinition<
    Name,
    Handle,
    Dependencies | EmptyResourceDependencies,
    ResourceConsumerHandle<typeof definition>
> {
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

function composeRuntimeContext<
    BaseContext extends Readonly<Record<string, unknown>>,
    Runtime extends RuntimeDefinition
>(
    context: BaseContext & RuntimeScopeGuard<BaseContext, Runtime>,
    runtime: Runtime,
    resourceHandles: RuntimeContext<Runtime>
): RuntimeContextComposition<BaseContext, Runtime>;
function composeRuntimeContext(
    context: Readonly<Record<string, unknown>>,
    runtime: RuntimeDefinition,
    resourceHandles: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
    const runtimes: unknown = Object.hasOwn(context, 'runtimes') ? Reflect.get(context, 'runtimes') : {};

    if (typeof runtimes !== 'object' || runtimes === null || Array.isArray(runtimes)) {
        throw new TypeError('composeRuntimeContext() requires context.runtimes to be an object when present.');
    }

    if (Object.hasOwn(runtimes, runtime.name)) {
        throw new TypeError(`Runtime scope "${runtime.name}" already exists.`);
    }

    return Object.freeze({
        ...context,
        runtimes: Object.freeze({
            ...runtimes,
            [runtime.name]: resourceHandles
        })
    });
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
