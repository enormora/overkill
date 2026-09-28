import type { ResourceDefinition } from './resource-definition-types.ts';
import { resourceDefinitionBrand } from './resource-definition-brand.ts';
import { freezeResourceScenarioSlots } from './resource-scenario.ts';

function defineResource(definition: Readonly<Record<string, unknown>>): unknown {
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

function isDefinedResource(resource: unknown): resource is ResourceDefinition {
    return typeof resource === 'object' &&
        resource !== null &&
        Reflect.get(resource, resourceDefinitionBrand) === true;
}

export const resourceDefinitionApi = Object.freeze({
    defineResource,
    isDefinedResource
});
