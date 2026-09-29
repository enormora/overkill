import type { ResourceDefinition } from './resource-definition-types.ts';
import { resourceDefinitionBrand } from './resource-definition-brand.ts';
import { freezeResourceScenarioSlots, type ResourceScenarioSlots } from './resource-scenario.ts';

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
