import {
    defineRuntime as createRuntimeDefinition,
    isDefinedRuntime as isRuntimeDefinition,
    type RuntimeDefinition as RuntimeDefinitionDescriptor,
    type RuntimeDefinitionInput as RuntimeDefinitionDescriptorInput,
    type RuntimeDimensions as RuntimeDimensionMap,
    type RuntimeId as RuntimeIdentity
} from './runtime-definition.ts';
import {
    composeRuntimes as composeRuntimeGraphs,
    defineRuntimeMatrix as createRuntimeMatrixDefinition,
    isComposedRuntimeGraph,
    isDefinedRuntimeMatrix as isRuntimeMatrixDefinition,
    runtimeGraphLeaves,
    type ComposedRuntimeGraph as ComposedRuntimeGraphDescriptor,
    type RuntimeGraph as RuntimeGraphDescriptor,
    type RuntimeGraphLeaf as RuntimeGraphLeafDescriptor,
    type RuntimeMatrixDefinition as RuntimeMatrixDescriptor,
    type RuntimeMatrixDefinitionInput as RuntimeMatrixDescriptorInput,
    type SharedRuntimeMatrixDefinitionInput as SharedRuntimeMatrixDescriptorInput,
    type RuntimeMatrixVariant as RuntimeMatrixVariantDescriptor
} from './runtime-matrix-definition.ts';
import type {
    AnyResourceDefinition as AnyResourceDefinitionShape,
    Awaitable as AwaitableShape,
    EmptyResourceDependencies as EmptyResourceDependenciesShape,
    ExecutionRequirement as ExecutionRequirementShape,
    ResourceDependencies as ResourceDependenciesShape,
    ResourceProjectionPayload as ResourceProjectionPayloadShape,
    ResourceScope as ResourceScopeShape,
    RuntimeResourceMap as RuntimeResourceMapShape,
    ValueOf
} from './resource-definition-shape.ts';

export type AnyResourceDefinition = AnyResourceDefinitionShape;
export type Awaitable<Value> = AwaitableShape<Value>;
export type EmptyResourceDependencies = EmptyResourceDependenciesShape;
export type ExecutionRequirement = ExecutionRequirementShape;
export type ResourceDependencies = ResourceDependenciesShape;
export type ResourceProjectionPayload = ResourceProjectionPayloadShape;
export type ResourceScope = ResourceScopeShape;
export type RuntimeResourceMap = RuntimeResourceMapShape;

export const defineRuntime = createRuntimeDefinition;
export const isDefinedRuntime = isRuntimeDefinition;
export const isDefinedRuntimeMatrix = isRuntimeMatrixDefinition;
export const composeRuntimes = composeRuntimeGraphs;

export type RuntimeDefinition<
    Name extends string = string,
    Dimensions extends RuntimeDimensionMap = RuntimeDimensionMap,
    Resources extends RuntimeResourceMap = RuntimeResourceMap
> = RuntimeDefinitionDescriptor<Name, Dimensions, Resources>;
export type RuntimeDefinitionInput<
    Name extends string,
    Dimensions extends RuntimeDimensionMap,
    Resources extends RuntimeResourceMap
> = RuntimeDefinitionDescriptorInput<Name, Dimensions, Resources>;
export type RuntimeDimensions = RuntimeDimensionMap;
export type RuntimeGraph = RuntimeGraphDescriptor;
export type RuntimeGraphLeaf = RuntimeGraphLeafDescriptor;
export type ComposedRuntimeGraph<
    Runtimes extends readonly RuntimeGraphLeaf[] = readonly RuntimeGraphLeaf[]
> = ComposedRuntimeGraphDescriptor<Runtimes>;
export type RuntimeId<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions
> = RuntimeIdentity<Name, Dimensions>;
export type RuntimeMatrixDefinition<
    Name extends string = string,
    Variants extends RuntimeMatrixVariantMap = RuntimeMatrixVariantMap
> = RuntimeMatrixDescriptor<Name, Variants>;
export type RuntimeMatrixDefinitionInput<
    Name extends string,
    Variants extends Readonly<Record<string, RuntimeDefinition>>
> = RuntimeMatrixDescriptorInput<Name, Variants>;
export type SharedRuntimeMatrixDefinitionInput<
    Name extends string,
    Shared,
    Variants extends Readonly<Record<string, RuntimeDefinition | ((shared: Shared) => RuntimeDefinition)>>
> = SharedRuntimeMatrixDescriptorInput<Name, Shared, Variants>;
export type RuntimeMatrixVariant<
    VariantId extends string = string,
    Runtime extends RuntimeDefinition = RuntimeDefinition
> = RuntimeMatrixVariantDescriptor<VariantId, Runtime>;
export type RuntimeMatrixVariantMap = Readonly<Record<string, RuntimeMatrixVariant>>;

const resourceDefinitionBrand: unique symbol = Symbol('overkill.resourceDefinition');

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

type UnionToIntersection<Value> =
    (Value extends unknown ? (value: Value) => void : never) extends (value: infer Intersection) => void
        ? Intersection
        : never;
type RuntimeGraphName<Graph extends RuntimeGraph> = Graph extends ComposedRuntimeGraph<infer Runtimes>
    ? RuntimeGraphName<Runtimes[number]>
    : Graph extends { readonly name: infer Name extends string; } ? Name
        : never;
type RuntimeMatrixRuntime<Matrix extends RuntimeMatrixDefinition> =
    Matrix['variants'][keyof Matrix['variants']]['runtime'];
type RuntimeGraphRuntime<Graph extends RuntimeGraphLeaf> = {
    readonly runtime: Extract<Graph, RuntimeDefinition>;
    readonly 'runtime-matrix': RuntimeMatrixRuntime<Extract<Graph, RuntimeMatrixDefinition>>;
}[Graph['kind']];
type RuntimeGraphResources<Runtime extends RuntimeGraphLeaf> = RuntimeGraphRuntime<Runtime>['resources'];

export type RuntimeContext<Runtime extends RuntimeGraphLeaf> = {
    readonly [Key in keyof RuntimeGraphResources<Runtime>]: ResourceHandle<RuntimeGraphResources<Runtime>[Key]>;
};

export type RuntimeGraphContext<Graph extends RuntimeGraph> = Graph extends ComposedRuntimeGraph
    ? RuntimeScopeContext<Graph>
    : RuntimeContext<Extract<Graph, RuntimeGraphLeaf>>;

export type RuntimeScopeContext<Runtime extends RuntimeGraph> = Readonly<
    Runtime extends ComposedRuntimeGraph<infer Runtimes>
        ? UnionToIntersection<RuntimeScopeContext<Runtimes[number]>>
        : Record<RuntimeGraphName<Runtime>, RuntimeContext<Extract<Runtime, RuntimeGraphLeaf>>>
>;

type EmptyRuntimeScopes = Pick<Readonly<Record<string, never>>, never>;
type RuntimeScopeKey<Runtime extends RuntimeGraph> = RuntimeGraphName<Runtime>;
type RuntimeScopes<Context> = Context extends {
    readonly runtimes: infer Runtimes extends Readonly<Record<string, unknown>>;
} ? Runtimes
    : EmptyRuntimeScopes;

type RuntimeScopeGuard<
    Context,
    Runtime extends RuntimeGraph
> = Extract<RuntimeScopeKey<Runtime>, keyof RuntimeScopes<Context>> extends never ? unknown : never;
type RuntimeScopeBaseContext<Context> = {
    readonly [Key in keyof Context as Key extends 'runtimes' ? never : Key]: Context[Key];
};
type ComposedRuntimeScopes<BaseContext, Runtime extends RuntimeGraph> = {
    readonly runtimes: RuntimeScopeContext<Runtime> & RuntimeScopes<BaseContext>;
};

export type RuntimeContextComposition<BaseContext, Runtime extends RuntimeGraph> = Readonly<
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
    readonly defineRuntimeMatrix: typeof createRuntimeMatrixDefinition;
    readonly composeRuntimes: typeof composeRuntimeGraphs;
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

function composeRuntimeContext<
    BaseContext extends Readonly<Record<string, unknown>>,
    Runtime extends RuntimeGraph
>(
    context: BaseContext & RuntimeScopeGuard<BaseContext, Runtime>,
    runtime: Runtime,
    resourceHandles: RuntimeGraphContext<Runtime>
): RuntimeContextComposition<BaseContext, Runtime>;
function composeRuntimeContext(
    context: Readonly<Record<string, unknown>>,
    runtime: RuntimeGraph,
    resourceHandles: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
    const runtimes: unknown = Object.hasOwn(context, 'runtimes') ? Reflect.get(context, 'runtimes') : {};

    if (typeof runtimes !== 'object' || runtimes === null || Array.isArray(runtimes)) {
        throw new TypeError('composeRuntimeContext() requires context.runtimes to be an object when present.');
    }

    const nextRuntimes = isComposedRuntimeGraph(runtime)
        ? resourceHandles
        : { [runtime.name]: resourceHandles };

    if (isComposedRuntimeGraph(runtime)) {
        for (const childRuntime of runtime.runtimes) {
            if (!Object.hasOwn(nextRuntimes, childRuntime.name)) {
                throw new TypeError(`Runtime scope "${childRuntime.name}" is missing.`);
            }
        }
    }

    for (const runtimeName of Object.keys(nextRuntimes)) {
        if (Object.hasOwn(runtimes, runtimeName)) {
            throw new TypeError(`Runtime scope "${runtimeName}" already exists.`);
        }
    }

    return Object.freeze({
        ...context,
        runtimes: Object.freeze({
            ...runtimes,
            ...nextRuntimes
        })
    });
}

export function createResourcesModule(dependencies: ResourcesModuleDependencies): ResourcesModule {
    return Object.freeze({
        composeRuntimeContext,
        createTemporaryDirectoryResource(name) {
            return createTemporaryDirectoryResource(dependencies, name);
        },
        composeRuntimes,
        defineResource,
        defineRuntime,
        defineRuntimeMatrix: createRuntimeMatrixDefinition
    });
}

export function isDefinedResource(resource: unknown): resource is AnyResourceDefinition {
    return typeof resource === 'object' &&
        resource !== null &&
        Reflect.get(resource, resourceDefinitionBrand) === true;
}

export function isDefinedRuntimeGraph(runtime: unknown): runtime is RuntimeGraph {
    return isDefinedRuntime(runtime) || isDefinedRuntimeMatrix(runtime) || isComposedRuntimeGraph(runtime);
}

export { runtimeGraphLeaves };
