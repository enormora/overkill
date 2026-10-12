import type { Except, Merge } from 'type-fest';
import type { WorkloadParameters } from '../engine/workload-input.ts';

import type {
    EmptyResourceScenarioSlots,
    ResourceScenarioDeclaration,
    ResourceScenarioSlotInputs,
    ResourceScenarioSlotsFromInputs
} from './resource-scenario.ts';
import type {
    EmptyResourceDependencies,
    ResourceDependencies,
    ResourceProjectionPayload,
    ResourceScope
} from './resource-definition-shape.ts';
import type {
    WorkloadLocalResourceInput,
    WorkloadProjectedResourceInput,
    LocalOnlyResourceDefinitionInput,
    ProjectedResourceDefinitionInput,
    ResourceDefinition,
    ScenarioLocalInput,
    ScenarioProjectedInput,
    WithDependencies
} from './resource-definition-types.ts';

type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';

export type DefineResource = {
    <
        const Name extends string,
        Handle,
        Scope extends Exclude<ResourceScope, 'per-run'>,
        Parameters extends WorkloadParameters,
        const ScenarioInputs extends ResourceScenarioSlotInputs,
        const Dependencies extends ResourceDependencies = EmptyResourceDependencies
    >(
        definition: Merge<
            Except<
                WorkloadLocalResourceInput<
                    Name,
                    Handle,
                    Scope,
                    Dependencies,
                    ResourceScenarioSlotsFromInputs<ScenarioInputs>,
                    Parameters
                >,
                'scenarios'
            >,
            ResourceScenarioDeclaration<ScenarioInputs>
        >
    ): ResourceDefinition<
        Name,
        Handle,
        Dependencies,
        Handle,
        ResourceScenarioSlotsFromInputs<ScenarioInputs>,
        Parameters
    >;
    <
        const Name extends string,
        Handle,
        Projection extends ResourceProjectionPayload,
        ConsumerHandle,
        Scope extends 'per-file' | 'per-run' | 'per-suite',
        Parameters extends WorkloadParameters,
        const ScenarioInputs extends ResourceScenarioSlotInputs,
        const Dependencies extends ResourceDependencies = EmptyResourceDependencies
    >(
        definition: Merge<
            Except<
                WorkloadProjectedResourceInput<
                    Name,
                    Handle,
                    Projection,
                    ConsumerHandle,
                    Scope,
                    Dependencies,
                    ResourceScenarioSlotsFromInputs<ScenarioInputs>,
                    Parameters
                >,
                'scenarios'
            >,
            ResourceScenarioDeclaration<ScenarioInputs>
        >
    ): ResourceDefinition<
        Name,
        Handle,
        Dependencies,
        ConsumerHandle,
        ResourceScenarioSlotsFromInputs<ScenarioInputs>,
        Parameters
    >;

    <
        const Name extends string,
        Handle,
        Scope extends Exclude<ResourceScope, 'per-run'>,
        Parameters extends WorkloadParameters,
        const Dependencies extends ResourceDependencies = EmptyResourceDependencies
    >(
        definition: Except<
            WorkloadLocalResourceInput<Name, Handle, Scope, Dependencies, EmptyResourceScenarioSlots, Parameters>,
            'scenarios'
        >
    ): ResourceDefinition<Name, Handle, Dependencies, Handle, EmptyResourceScenarioSlots, Parameters>;
    <
        const Name extends string,
        Handle,
        Projection extends ResourceProjectionPayload,
        ConsumerHandle,
        Scope extends 'per-file' | 'per-run' | 'per-suite',
        Parameters extends WorkloadParameters,
        const Dependencies extends ResourceDependencies = EmptyResourceDependencies
    >(
        definition: Except<
            WorkloadProjectedResourceInput<
                Name,
                Handle,
                Projection,
                ConsumerHandle,
                Scope,
                Dependencies,
                EmptyResourceScenarioSlots,
                Parameters
            >,
            'scenarios'
        >
    ): ResourceDefinition<Name, Handle, Dependencies, ConsumerHandle, EmptyResourceScenarioSlots, Parameters>;
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
    <
        const Name extends string,
        Handle,
        Scope extends Exclude<ResourceScope, 'per-run'>
    >(definition: Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope>, 'scenarios'>): ResourceDefinition<
        Name,
        Handle,
        EmptyResourceDependencies,
        Handle
    >;
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
