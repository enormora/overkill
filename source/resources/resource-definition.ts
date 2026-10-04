import type { Except } from 'type-fest';
import type {
    EmptyResourceDependencies,
    ResourceDependencies,
    ResourceProjectionPayload,
    ResourceScope
} from './resource-definition-shape.ts';
import type {
    LocalOnlyResourceDefinitionInput,
    ProjectedResourceDefinitionInput,
    ResourceDefinition,
    ScenarioLocalInput,
    ScenarioProjectedInput,
    WithDependencies
} from './resource-definition-types.ts';
import { resourceDefinitionBrand } from './resource-definition-brand.ts';
import {
    freezeResourceScenarioSlots,
    type ResourceScenarioSlotInputs,
    type ResourceScenarioSlots,
    type ResourceScenarioSlotsFromInputs
} from './resource-scenario.ts';

type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function resourceDependencies(
    definition: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
    const declaredDependencies: unknown = Reflect.get(definition, 'dependencies');

    return isRecord(declaredDependencies)
        ? Object.freeze(declaredDependencies)
        : Object.freeze({});
}

function resourceScenarios(definition: Readonly<Record<string, unknown>>): ResourceScenarioSlots {
    return Object.hasOwn(definition, 'scenarios')
        ? freezeResourceScenarioSlots(Reflect.get(definition, 'scenarios'))
        : Object.freeze({});
}

function resourceHandleExposure(
    definition: Readonly<Record<string, unknown>>,
    scenarios: ResourceScenarioSlots
): unknown {
    const hasRequestRoutedScenario = Object.values(scenarios).some(function isRequestRouted(slot) {
        return slot.timing === 'request-routed';
    });
    const declaredExposeHandle: unknown = Reflect.get(definition, 'exposeHandle');

    if (!hasRequestRoutedScenario) {
        if (declaredExposeHandle !== undefined && declaredExposeHandle !== null) {
            throw new TypeError('Resource exposeHandle() requires a request-routed scenario.');
        }

        return null;
    }

    if (typeof declaredExposeHandle !== 'function') {
        throw new TypeError(`Resource "${String(Reflect.get(definition, 'name'))}" requires exposeHandle().`);
    }

    return declaredExposeHandle;
}

function defineResource<
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
function defineResource<
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
function defineResource<
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
function defineResource<
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
function defineResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>
>(definition: Except<LocalOnlyResourceDefinitionInput<Name, Handle, Scope>, 'scenarios'>): ResourceDefinition<
    Name,
    Handle,
    EmptyResourceDependencies,
    Handle
>;
function defineResource<
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
function defineResource<
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
function defineResource<
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
function defineResource(definition: Readonly<Record<string, unknown>>): unknown {
    const scenarios = resourceScenarios(definition);

    return Object.freeze({
        ...definition,
        dependencies: resourceDependencies(definition),
        exposeHandle: resourceHandleExposure(definition, scenarios),
        scenarios,
        [resourceDefinitionBrand]: true as const
    });
}

function isDefinedResource(resource: unknown): resource is ResourceDefinition {
    return typeof resource === 'object' &&
        resource !== null &&
        Reflect.get(resource, resourceDefinitionBrand) === true;
}

export const resourceDefinitionApi = Object.freeze({
    defineResource,
    isDefinedResource
});
