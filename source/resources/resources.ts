const resourceDefinitionBrand: unique symbol = Symbol('overkill.resourceDefinition');
const runtimeDefinitionBrand: unique symbol = Symbol('overkill.runtimeDefinition');

type Awaitable<Value> = Promise<Value> | Value;
type ExclusiveResource = { readonly kind: 'exclusive-resource'; readonly name: string; };
type SerialExecution = { readonly kind: 'serial'; };
type SingleWorkerExecution = { readonly kind: 'single-worker'; };
type StartupBudget = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};
type AnyResourceDefinition = {
    readonly dependencies: Readonly<Record<string, unknown>>;
    readonly name: string;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly [resourceDefinitionBrand]: true;
};
type RuntimeResourceMap = Readonly<Record<string, AnyResourceDefinition>>;
type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;
type RuntimeResourceName<Resources extends RuntimeResourceMap> = Resources[keyof Resources]['name'];
type ResourceDependency = ResourceDependencies[keyof ResourceDependencies];
type ResourceDependencyName<Resource extends AnyResourceDefinition> =
    Resource['dependencies'][keyof Resource['dependencies']] extends ResourceDependency
        ? Resource['dependencies'][keyof Resource['dependencies']]['name']
        : never;
type RuntimeResourceDependency<
    Resources extends RuntimeResourceMap,
    Resource extends AnyResourceDefinition
> = Exclude<ResourceDependencyName<Resource>, RuntimeResourceName<Resources>> extends never ? Resource
    : never;
type RuntimeResourcesInput<Resources extends RuntimeResourceMap> = {
    readonly [Key in keyof Resources]: RuntimeResourceDependency<Resources, Resources[Key]>;
};

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

export type ResourceContext<Resources extends ResourceDependencies> = {
    readonly [Key in keyof Resources]: ResourceHandle<Resources[Key]>;
};

export type ResourceCreationContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly resources: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
};

export type ResourceDisposalContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly resources: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
};

export type ResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = {
    readonly dependencies?: Dependencies;
    readonly name: Name;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
};

export type ResourceDefinition<
    Name extends string = string,
    Handle = unknown,
    Dependencies extends ResourceDependencies = ResourceDependencies
> = {
    readonly dependencies: Dependencies;
    readonly name: Name;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: ResourceCreationContext<Dependencies>) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>) | null;
    readonly [resourceDefinitionBrand]: true;
};

export type ResourceHandle<Resource extends AnyResourceDefinition> = Awaited<ReturnType<Resource['acquire']>>;

export type RuntimeDefinitionInput<
    Name extends string,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = {
    readonly name: Name;
    readonly dimensions: Dimensions;
    readonly resources: Resources;
    readonly requirements: readonly ExecutionRequirement[];
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

export type RuntimeContextComposition<BaseContext, Runtime extends RuntimeDefinition> = BaseContext & {
    readonly runtime: RuntimeContext<Runtime>;
};

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

function defineResource<const Name extends string, Handle>(
    definition: ResourceDefinitionInput<Name, Handle>
): ResourceDefinition<Name, Handle, EmptyResourceDependencies>;
function defineResource<const Name extends string, Handle, const Dependencies extends ResourceDependencies>(
    definition: ResourceDefinitionInput<Name, Handle, Dependencies> & {
        readonly dependencies: Dependencies;
    }
): ResourceDefinition<Name, Handle, Dependencies>;
function defineResource<const Name extends string, Handle, const Dependencies extends ResourceDependencies>(
    definition: ResourceDefinitionInput<Name, Handle, Dependencies>
): ResourceDefinition<Name, Handle, Dependencies | EmptyResourceDependencies> {
    if (definition.dependencies === undefined) {
        return Object.freeze({
            ...definition,
            dependencies: {},
            [resourceDefinitionBrand]: true as const
        });
    }

    return Object.freeze({
        ...definition,
        dependencies: definition.dependencies,
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

function defineRuntime<
    const Name extends string,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap
>(
    definition: RuntimeDefinitionInput<Name, Dimensions, Resources> & {
        readonly resources: RuntimeResourcesInput<Resources>;
    }
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
    context: BaseContext,
    _runtime: Runtime,
    resourceHandles: RuntimeContext<Runtime>
): RuntimeContextComposition<BaseContext, Runtime> {
    return Object.freeze({
        ...context,
        runtime: resourceHandles
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
