import type { Except, Merge } from 'type-fest';
import type {
    LocalOnlyResourceDefinitionInput,
    ProjectedResourceDefinitionInput,
    ResourceDefinition
} from './resource-definition-types.ts';
import type {
    EmptyResourceDependencies,
    ResourceDependencies,
    ResourceProjectionPayload,
    ResourceScope
} from './resource-definition-shape.ts';
import { resourceDefinitionBrand } from './resource-definition-brand.ts';
import {
    freezeResourceScenarioSlots,
    type ResourceScenarioSlotInputs,
    type ResourceScenarioSlotsFromInputs
} from './resource-scenario.ts';

type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';

type WithDependencies<Input, Dependencies extends ResourceDependencies> = Merge<
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

type ScenarioLocalInput<
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

type ScenarioProjectedInput<
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

export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: WithDependencies<ScenarioLocalInput<Name, Handle, Scope, Dependencies, ScenarioInputs>, Dependencies>
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
): ResourceDefinition<Name, OwnerHandle, Dependencies, ConsumerHandle, ResourceScenarioSlotsFromInputs<ScenarioInputs>>;
export function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const ScenarioInputs extends ResourceScenarioSlotInputs
>(
    definition: Except<
        ScenarioLocalInput<
            Name,
            Handle,
            Scope,
            EmptyResourceDependencies,
            ScenarioInputs
        >,
        'dependencies'
    >
): ResourceDefinition<Name, Handle, EmptyResourceDependencies, Handle, ResourceScenarioSlotsFromInputs<ScenarioInputs>>;
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
>(
    definition: Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope>, 'scenarios'>
): ResourceDefinition<Name, Handle, EmptyResourceDependencies, Handle>;
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
    const declaredDependencies: unknown = Reflect.get(definition, 'dependencies');
    const dependencies = typeof declaredDependencies === 'object' && declaredDependencies !== null
        ? Object.freeze(declaredDependencies)
        : Object.freeze({});
    const scenarios = Object.hasOwn(definition, 'scenarios')
        ? freezeResourceScenarioSlots(Reflect.get(definition, 'scenarios'))
        : Object.freeze({});

    return Object.freeze({
        ...definition,
        dependencies,
        scenarios,
        [resourceDefinitionBrand]: true as const
    });
}

export function isDefinedResource(resource: unknown): resource is ResourceDefinition {
    return typeof resource === 'object' &&
        resource !== null &&
        Reflect.get(resource, resourceDefinitionBrand) === true;
}
