import type { Except, Merge } from 'type-fest';
import type { RuntimeAttachments } from '../engine/runtime-attachment.ts';
import type {
    AnyResourceDefinition,
    Awaitable,
    EmptyResourceDependencies,
    ExecutionRequirement,
    ResourceDependencies,
    ResourceProjectionPayload,
    ResourceScope,
    ValueOf
} from './resource-definition-shape.ts';
import type { resourceDefinitionBrand } from './resource-definition-brand.ts';
import type {
    EmptyResourceScenarioSlots,
    ResourceScenarioBindingsForTiming,
    ResourceScenarioSlotInputs,
    ResourceScenarioSlotsFromInputs,
    ResourceScenarioSlots
} from './resource-scenario.ts';

type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';

export type WithDependencies<Input, Dependencies extends ResourceDependencies> = Merge<
    Input,
    { readonly dependencies: Dependencies; }
>;

type WithScenarios<
    Input extends { readonly scenarios: unknown; },
    ScenarioInputs extends ResourceScenarioSlotInputs
> = Merge<
    Except<Input, 'scenarios'>,
    { readonly scenarios: ScenarioInputs; }
>;

export type ResourceProjectionContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly attachments: RuntimeAttachments;
    readonly dependencies: ResourceContext<Dependencies>;
};

export type ResourceHandleExposureContext<
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = {
    readonly attachments: RuntimeAttachments;
    readonly scenarios: ResourceScenarioBindingsForTiming<Scenarios, 'request-routed'>;
};

export type ResourceHandle<Resource extends AnyResourceDefinition> = Resource extends {
    readonly deserializeHandle?: ((payload: never, context: never) => infer ConsumerHandle) | undefined;
} ? ConsumerHandle
    : Awaited<ReturnType<Resource['acquire']>>;

export type ResourceContext<Resources extends ResourceDependencies> = {
    readonly [Key in keyof Resources]: ResourceHandle<Resources[Key]>;
};

export type ResourceCreationContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = {
    readonly attachments: RuntimeAttachments;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly scenarios: ResourceScenarioBindingsForTiming<Scenarios, 'acquire'>;
    readonly signal: AbortSignal;
};

export type ResourceDisposalContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = {
    readonly attachments: RuntimeAttachments;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly scenarios: ResourceScenarioBindingsForTiming<Scenarios, 'acquire'>;
    readonly signal: AbortSignal;
};

type RequestRoutedScenarioNames<Scenarios extends ResourceScenarioSlots> = keyof {
    readonly [Slot in keyof Scenarios as 'request-routed' extends Scenarios[Slot]['timing'] ? Slot : never]: true;
};

type ResourceHandleExposureInput<Handle, Scenarios extends ResourceScenarioSlots> = {
    readonly exposeHandle?: (handle: Handle, context: ResourceHandleExposureContext<Scenarios>) => Handle;
};

type ResourceHandleExposureDefinition<Handle, Scenarios extends ResourceScenarioSlots> =
    RequestRoutedScenarioNames<Scenarios> extends never ? { readonly exposeHandle: null; } : {
        readonly exposeHandle: (handle: Handle, context: ResourceHandleExposureContext<Scenarios>) => Handle;
    };

type ResourceDisposal<
    Handle,
    Dependencies extends ResourceDependencies,
    Scenarios extends ResourceScenarioSlots
> = ((handle: Handle, context: ResourceDisposalContext<Dependencies, Scenarios>) => Awaitable<void>) | null;

type ResourceDefinitionBaseInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = {
    readonly acquire: (context: ResourceCreationContext<Dependencies, Scenarios>) => Awaitable<Handle>;
    readonly dependencies?: Dependencies;
    readonly dispose: ResourceDisposal<Handle, Dependencies, Scenarios>;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
};

export type LocalOnlyResourceDefinitionInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = Merge<
    ResourceDefinitionBaseInput<Name, Handle, Scope, Dependencies, Scenarios>,
    ResourceHandleExposureInput<Handle, NoInfer<Scenarios>> & {
        readonly deserializeHandle?: never;
        readonly scenarios: Scenarios;
        readonly serializeHandle?: never;
    }
>;

export type ProjectedResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends 'per-file' | 'per-run' | 'per-suite',
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = Merge<
    ResourceDefinitionBaseInput<Name, OwnerHandle, Scope, Dependencies, Scenarios>,
    ResourceHandleExposureInput<ConsumerHandle, NoInfer<Scenarios>> & {
        readonly deserializeHandle: (
            payload: Projection,
            context: ResourceProjectionContext<Dependencies>
        ) => ConsumerHandle;
        readonly scenarios: Scenarios;
        readonly serializeHandle: (
            handle: OwnerHandle,
            context: ResourceProjectionContext<Dependencies>
        ) => Projection;
    }
>;

export type ScenarioLocalInput<
    Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    Dependencies extends ResourceDependencies,
    ScenarioInputs extends ResourceScenarioSlotInputs
> = WithScenarios<
    LocalOnlyResourceDefinitionInput<
        Name,
        Handle,
        Scope,
        Dependencies,
        ResourceScenarioSlotsFromInputs<ScenarioInputs>
    >,
    ScenarioInputs
>;

export type ScenarioProjectedInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedResourceScope,
    Dependencies extends ResourceDependencies,
    ScenarioInputs extends ResourceScenarioSlotInputs
> = WithScenarios<
    ProjectedResourceDefinitionInput<
        Name,
        OwnerHandle,
        Projection,
        ConsumerHandle,
        Scope,
        Dependencies,
        ResourceScenarioSlotsFromInputs<ScenarioInputs>
    >,
    ScenarioInputs
>;

export type DefineResource = {
    <
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
    <
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
    <
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
    <
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
    <const Name extends string, Handle, Scope extends Exclude<ResourceScope, 'per-run'>>(
        definition: Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope>, 'scenarios'>
    ): ResourceDefinition<Name, Handle, EmptyResourceDependencies, Handle>;
    <
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
    <
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
    <
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
};

export type ResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Projection extends ResourceProjectionPayload = ResourceProjectionPayload,
    ConsumerHandle = Handle
> = Except<
    ValueOf<ResourceDefinitionInputOptions<Name, Handle, Dependencies, Projection, ConsumerHandle>>,
    'scenarios'
>;

type ResourceDefinitionInputOptions<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle
> = {
    readonly local: LocalResourceDefinitionInput<Name, Handle, Dependencies>;
    readonly projected: ProjectedResourceInput<Name, Handle, Projection, ConsumerHandle, Dependencies>;
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
    readonly file: ProjectedResourceDefinitionInput<
        Name,
        Handle,
        Projection,
        ConsumerHandle,
        'per-file' | 'per-suite',
        Dependencies
    >;
    readonly run: ProjectedResourceDefinitionInput<
        Name,
        Handle,
        Projection,
        ConsumerHandle,
        'per-run',
        Dependencies
    >;
};

export type ResourceDefinition<
    Name extends string = string,
    OwnerHandle = unknown,
    Dependencies extends ResourceDependencies = ResourceDependencies,
    ConsumerHandle = OwnerHandle,
    Scenarios extends ResourceScenarioSlots = EmptyResourceScenarioSlots
> = ResourceHandleExposureDefinition<ConsumerHandle, Scenarios> & {
    readonly acquire: (context: ResourceCreationContext<Dependencies, Scenarios>) => Awaitable<OwnerHandle>;
    readonly dependencies: Dependencies;
    readonly deserializeHandle?: (
        payload: ResourceProjectionPayload,
        context: ResourceProjectionContext<Dependencies>
    ) => ConsumerHandle;
    readonly dispose: ResourceDisposal<OwnerHandle, Dependencies, Scenarios>;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scenarios: Scenarios;
    readonly scope: ResourceScope;
    readonly serializeHandle?: (
        handle: OwnerHandle,
        context: ResourceProjectionContext<Dependencies>
    ) => ResourceProjectionPayload;
    readonly [resourceDefinitionBrand]: true;
};
