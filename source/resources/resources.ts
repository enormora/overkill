import type { Except } from 'type-fest';
import {
    defineRuntime as createRuntimeDefinition,
    isDefinedRuntime as isRuntimeDefinition,
    resolvedRuntimeScenarioOwners as readRuntimeScenarioOwners,
    type RuntimeDefinition as RuntimeDefinitionDescriptor,
    type RuntimeDefinitionInput as RuntimeDefinitionDescriptorInput,
    type RuntimeDimensions as RuntimeDimensionMap,
    type RuntimeId as RuntimeIdentity,
    type RuntimeScenarioOwner as RuntimeScenarioOwnerShape
} from './runtime-definition.ts';
import {
    runtimeMatrixDefinitionApi,
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
    RuntimeResourceMap as RuntimeResourceMapShape
} from './resource-definition-shape.ts';
import { resourceDefinitionApi } from './resource-definition.ts';
import type {
    DefineResource as DefineResourceShape,
    LocalOnlyResourceDefinitionInput as LocalOnlyResourceDefinitionInputShape,
    ProjectedResourceDefinitionInput as ProjectedResourceDefinitionInputShape,
    ResourceContext as ResourceContextShape,
    ResourceCreationContext as ResourceCreationContextShape,
    ResourceDefinition as ResourceDefinitionShape,
    ResourceDefinitionInput as ResourceDefinitionInputShape,
    ResourceDisposalContext as ResourceDisposalContextShape,
    ResourceHandle as ResourceHandleShape,
    ResourceProjectionContext as ResourceProjectionContextShape,
    ScenarioLocalInput as ScenarioLocalInputShape,
    ScenarioProjectedInput as ScenarioProjectedInputShape,
    WithDependencies as WithDependenciesShape
} from './resource-definition-types.ts';
import type {
    ResourceScenarioBindings as ResourceScenarioBindingsShape,
    ResourceScenarioSlot as ResourceScenarioSlotShape,
    ResourceScenarioSlotInput as ResourceScenarioSlotInputShape,
    ResourceScenarioSlotInputs as ResourceScenarioSlotInputsShape,
    ResourceScenarioSlots as ResourceScenarioSlotsShape,
    ResourceScenarioSlotsFromInputs as ResourceScenarioSlotsFromInputsShape,
    ScenarioTiming as ScenarioTimingShape
} from './resource-scenario.ts';
import { resolvedResourceScenarioBindings as readResourceScenarioBindings } from './resource-scenario-binding.ts';

const composeRuntimeGraphs = runtimeMatrixDefinitionApi.composeRuntimes;
const createRuntimeMatrixDefinition = runtimeMatrixDefinitionApi.defineRuntimeMatrix;
const { isComposedRuntimeGraph } = runtimeMatrixDefinitionApi;
const isRuntimeMatrixDefinition = runtimeMatrixDefinitionApi.isDefinedRuntimeMatrix;
const runtimeGraphLeafDescriptors = runtimeMatrixDefinitionApi.runtimeGraphLeaves;
const createResourceDescriptor = resourceDefinitionApi.defineResource;
const isResourceDefinition = resourceDefinitionApi.isDefinedResource;

export type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';
export type WithDependencies<Input, Dependencies extends ResourceDependencies> = WithDependenciesShape<
    Input,
    Dependencies
>;
export type LocalOnlyResourceDefinitionInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = Readonly<Record<PropertyKey, never>>
> = LocalOnlyResourceDefinitionInputShape<Name, Handle, Scope, Dependencies, Scenarios>;
export type ProjectedResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = Readonly<Record<PropertyKey, never>>
> = ProjectedResourceDefinitionInputShape<
    Name,
    OwnerHandle,
    Projection,
    ConsumerHandle,
    Scope,
    Dependencies,
    Scenarios
>;
export type ScenarioLocalInput<
    Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    Dependencies extends ResourceDependencies,
    ScenarioInputs extends ResourceScenarioSlotInputs
> = ScenarioLocalInputShape<Name, Handle, Scope, Dependencies, ScenarioInputs>;
export type ScenarioProjectedInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    Dependencies extends ResourceDependencies,
    ScenarioInputs extends ResourceScenarioSlotInputs
> = ScenarioProjectedInputShape<
    Name,
    OwnerHandle,
    Projection,
    ConsumerHandle,
    Scope,
    Dependencies,
    ScenarioInputs
>;

export const {
    isDefinedResource,
    resolvedResourceScenarioBindings,
    resolvedRuntimeScenarioOwners
} = Object.freeze({
    isDefinedResource: isResourceDefinition,
    resolvedResourceScenarioBindings: readResourceScenarioBindings,
    resolvedRuntimeScenarioOwners: readRuntimeScenarioOwners
});
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: WithDependencies<
        ScenarioLocalInput<Name, Handle, Scope, Dependencies, ScenarioInputs>,
        Dependencies
    >
): ResourceDefinition<Name, Handle, Dependencies, Handle, ResourceScenarioSlotsFromInputs<ScenarioInputs>>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    const Dependencies extends ResourceDependencies,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: WithDependencies<
        ScenarioProjectedInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope, Dependencies, ScenarioInputs>,
        Dependencies
    >
): ResourceDefinition<
    Name,
    OwnerHandle,
    Dependencies,
    ConsumerHandle,
    ResourceScenarioSlotsFromInputs<ScenarioInputs>
>;
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: Except<
        ScenarioLocalInput<Name, Handle, Scope, EmptyResourceDependencies, ScenarioInputs>,
        'dependencies'
    >
): ResourceDefinition<
    Name,
    Handle,
    EmptyResourceDependencies,
    Handle,
    ResourceScenarioSlotsFromInputs<ScenarioInputs>
>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: Except<
        ScenarioProjectedInput<
            Name,
            OwnerHandle,
            Projection,
            ConsumerHandle,
            Scope,
            EmptyResourceDependencies,
            ScenarioInputs
        >,
        'dependencies'
    >
): ResourceDefinition<
    Name,
    OwnerHandle,
    EmptyResourceDependencies,
    ConsumerHandle,
    ResourceScenarioSlotsFromInputs<ScenarioInputs>
>;
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>
>(definition: Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope>, 'scenarios'>): ResourceDefinition<
    Name,
    Handle,
    EmptyResourceDependencies,
    Handle
>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope
>(
    definition: Except<
        ProjectedResourceDefinitionInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope>,
        'scenarios'
    >
): ResourceDefinition<Name, OwnerHandle, EmptyResourceDependencies, ConsumerHandle>;
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies
>(
    definition: WithDependencies<
        Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope, Dependencies>, 'scenarios'>,
        Dependencies
    >
): ResourceDefinition<Name, Handle, Dependencies, Handle>;
export function defineResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    const Dependencies extends ResourceDependencies
>(
    definition: WithDependencies<
        Except<
            ProjectedResourceDefinitionInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope, Dependencies>,
            'scenarios'
        >,
        Dependencies
    >
): ResourceDefinition<Name, OwnerHandle, Dependencies, ConsumerHandle>;
export function defineResource(definition: Readonly<Record<string, unknown>>): unknown {
    return Reflect.apply(createResourceDescriptor, undefined, [ definition ]);
}
export type RuntimeScenarioOwner = RuntimeScenarioOwnerShape;
export type ResourceScenarioBindings<
    Scenarios extends ResourceScenarioSlots
> = ResourceScenarioBindingsShape<Scenarios>;
export type ResourceScenarioSlot<Scenario extends string = string> = ResourceScenarioSlotShape<Scenario>;
export type ResourceScenarioSlotInput<Scenario extends string = string> = ResourceScenarioSlotInputShape<Scenario>;
export type ResourceScenarioSlotInputs = ResourceScenarioSlotInputsShape;
export type ResourceScenarioSlots = ResourceScenarioSlotsShape;
export type ResourceScenarioSlotsFromInputs<
    Inputs extends ResourceScenarioSlotInputs
> = ResourceScenarioSlotsFromInputsShape<Inputs>;
export type ScenarioTiming = ScenarioTimingShape;

export type AnyResourceDefinition = AnyResourceDefinitionShape;
export type Awaitable<Value> = AwaitableShape<Value>;
export type EmptyResourceDependencies = EmptyResourceDependenciesShape;
export type ExecutionRequirement = ExecutionRequirementShape;
export type ResourceDependencies = ResourceDependenciesShape;
export type ResourceProjectionPayload = ResourceProjectionPayloadShape;
export type ResourceScope = ResourceScopeShape;
export type RuntimeResourceMap = RuntimeResourceMapShape;
export type ResourceContext<Resources extends ResourceDependencies> = ResourceContextShape<Resources>;
export type ResourceCreationContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = Readonly<Record<PropertyKey, never>>
> = ResourceCreationContextShape<Dependencies, Scenarios>;
export type ResourceDefinition<
    Name extends string = string,
    OwnerHandle = unknown,
    Dependencies extends ResourceDependencies = ResourceDependencies,
    ConsumerHandle = OwnerHandle,
    Scenarios extends ResourceScenarioSlots = Readonly<Record<PropertyKey, never>>
> = ResourceDefinitionShape<Name, OwnerHandle, Dependencies, ConsumerHandle, Scenarios>;
export type ResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Projection extends ResourceProjectionPayload = ResourceProjectionPayload,
    ConsumerHandle = Handle
> = ResourceDefinitionInputShape<Name, Handle, Dependencies, Projection, ConsumerHandle>;
export type ResourceDisposalContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = Readonly<Record<PropertyKey, never>>
> = ResourceDisposalContextShape<Dependencies, Scenarios>;
export type ResourceHandle<Resource extends AnyResourceDefinition> = ResourceHandleShape<Resource>;
export type ResourceProjectionContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = ResourceProjectionContextShape<Dependencies>;
export const defineRuntime = createRuntimeDefinition;
export const isDefinedRuntime = isRuntimeDefinition;
export const isDefinedRuntimeMatrix = isRuntimeMatrixDefinition;
export const composeRuntimes = composeRuntimeGraphs;

export type RuntimeDefinition<
    Name extends string = string,
    Dimensions extends RuntimeDimensionMap = RuntimeDimensionMap,
    Resources extends RuntimeResourceMap = RuntimeResourceMap,
    Scenarios extends ResourceScenarioSlots = ResourceScenarioSlots
> = RuntimeDefinitionDescriptor<Name, Dimensions, Resources, Scenarios>;
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

type UnionToIntersection<Value> = (
    Value extends unknown ? (value: Value) => void : never
) extends (value: infer Intersection) => void ? Intersection : never;
type RuntimeGraphName<Graph extends RuntimeGraph> = ComposedRuntimeNames<Graph> | NamedRuntimeGraphName<Graph>;
type ComposedRuntimeNames<Graph extends RuntimeGraph> = Graph extends ComposedRuntimeGraph<infer Runtimes>
    ? RuntimeGraphName<Runtimes[number]>
    : never;
type NamedRuntimeGraphName<Graph> = Graph extends { readonly name: infer Name extends string; } ? Name : never;
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
    Runtime extends ComposedRuntimeGraph<infer Runtimes> ? UnionToIntersection<RuntimeScopeContext<Runtimes[number]>>
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

function assertRuntimeContextHandles(
    runtime: RuntimeGraph,
    nextRuntimes: Readonly<Record<string, unknown>>
): void {
    if (!isComposedRuntimeGraph(runtime)) {
        return;
    }

    for (const childRuntime of runtime.runtimes) {
        if (!Object.hasOwn(nextRuntimes, childRuntime.name)) {
            throw new TypeError(`Runtime scope "${childRuntime.name}" is missing.`);
        }
    }
}

function runtimeContextHandles(
    runtime: RuntimeGraph,
    resourceHandles: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
    return isComposedRuntimeGraph(runtime)
        ? resourceHandles
        : { [runtime.name]: resourceHandles };
}

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
    readonly defineResource: DefineResourceShape;
    readonly defineRuntime: typeof defineRuntime;
    readonly defineRuntimeMatrix: typeof createRuntimeMatrixDefinition;
    readonly composeRuntimes: typeof composeRuntimeGraphs;
};

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

    const nextRuntimes = runtimeContextHandles(runtime, resourceHandles);
    const duplicateRuntimeName = Object.keys(nextRuntimes).find(function runtimeNameExists(runtimeName) {
        return Object.hasOwn(runtimes, runtimeName);
    });

    assertRuntimeContextHandles(runtime, nextRuntimes);

    if (duplicateRuntimeName !== undefined) {
        throw new TypeError(`Runtime scope "${duplicateRuntimeName}" already exists.`);
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

export function isDefinedRuntimeGraph(runtime: unknown): runtime is RuntimeGraph {
    return isDefinedRuntime(runtime) || isDefinedRuntimeMatrix(runtime) || isComposedRuntimeGraph(runtime);
}

export function runtimeGraphLeaves(runtime: RuntimeGraph): readonly RuntimeGraphLeaf[] {
    const leaves = runtimeGraphLeafDescriptors(runtime);

    return leaves;
}
