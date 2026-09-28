import type { AnyResourceDefinition, ResourceDependencies } from './resource-definition-shape.ts';
import {
    defaultScenarioBindings,
    type EmptyResourceScenarioSlots,
    type ResourceScenarioSlot,
    type ResourceScenarioSlots
} from './resource-scenario.ts';

type UnionToIntersection<Value> = (
    Value extends unknown ? (value: Value) => void : never
) extends (value: infer Intersection) => void ? Intersection : never;

type ScenarioDepth = 'eight' | 'five' | 'four' | 'one' | 'seven' | 'six' | 'stop' | 'three' | 'two';
type PreviousScenarioDepth = {
    readonly eight: 'seven';
    readonly five: 'four';
    readonly four: 'three';
    readonly one: 'stop';
    readonly seven: 'six';
    readonly six: 'five';
    readonly stop: 'stop';
    readonly three: 'two';
    readonly two: 'one';
};

type DependencyScenarioSlots<
    Dependencies extends ResourceDependencies,
    Depth extends ScenarioDepth
> = string extends keyof Dependencies ? EmptyResourceScenarioSlots
    : ResourceScenarioSlotsFromResources<Dependencies[keyof Dependencies], PreviousScenarioDepth[Depth]>;

type ResourceScenarioSlotsFromDependencies<
    Dependencies extends ResourceDependencies,
    Depth extends ScenarioDepth
> = Depth extends 'stop' ? EmptyResourceScenarioSlots
    : DependencyScenarioSlots<Dependencies, Depth>;

type ResourceScenarioSlotsFromResource<Resource, Depth extends ScenarioDepth> = Resource extends {
    readonly dependencies: infer Dependencies extends ResourceDependencies;
    readonly scenarios: infer Scenarios extends ResourceScenarioSlots;
} ? ResourceScenarioSlotsFromDependencies<Dependencies, Depth> & Scenarios
    : EmptyResourceScenarioSlots;

type ResourceScenarioSlotsFromResources<Resources, Depth extends ScenarioDepth> = [Resources] extends [never]
    ? EmptyResourceScenarioSlots
    : UnionToIntersection<ResourceScenarioSlotsFromResource<Resources, Depth>>;

export type ResourceMapScenarioSlots<Resources extends ResourceDependencies> = ResourceScenarioSlotsFromResources<
    Resources[keyof Resources],
    'eight'
> extends infer Scenarios extends ResourceScenarioSlots ? Scenarios
    : EmptyResourceScenarioSlots;

export type ResourceScenarioOwner = {
    readonly path: readonly string[];
    readonly resource: AnyResourceDefinition;
    readonly slot: ResourceScenarioSlot;
};

export type ResolvedResourceScenarioBindings = Readonly<Record<string, string>>;

const boundResourceScenarios = new WeakMap<AnyResourceDefinition, ResolvedResourceScenarioBindings>();

function isScenarioTiming(value: unknown): boolean {
    return value === 'acquire' || value === 'request-routed';
}

function isScenarioValues(value: unknown): value is readonly [string, ...string[]] {
    return Array.isArray(value) && value.length > 0 && value.every(function valueIsString(item) {
        return typeof item === 'string';
    });
}

function isResourceScenarioSlot(value: unknown): value is ResourceScenarioSlot {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const defaultValue: unknown = Reflect.get(value, 'default');
    const timing: unknown = Reflect.get(value, 'timing');
    const values: unknown = Reflect.get(value, 'values');

    return typeof defaultValue === 'string' && isScenarioTiming(timing) && isScenarioValues(values);
}

function isResourceDefinition(value: unknown): value is AnyResourceDefinition {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'name') === 'string' &&
        typeof Reflect.get(value, 'dependencies') === 'object' &&
        typeof Reflect.get(value, 'scenarios') === 'object';
}

export function resourceScenarioOwners(
    resources: ResourceDependencies
): ReadonlyMap<string, ResourceScenarioOwner> {
    const owners = new Map<string, ResourceScenarioOwner>();
    const visited = new Set<AnyResourceDefinition>();

    function recordScenario(
        resource: AnyResourceDefinition,
        path: readonly string[],
        name: string,
        slot: ResourceScenarioSlot
    ): void {
        const existing = owners.get(name);

        if (existing !== undefined && existing.resource !== resource) {
            throw new TypeError(`Scenario slot "${name}" is declared by multiple resources.`);
        }

        owners.set(name, { path, resource, slot });
    }

    function recordOwnedScenarios(resource: AnyResourceDefinition, path: readonly string[]): void {
        const scenarios: unknown = Reflect.get(resource, 'scenarios');

        if (typeof scenarios !== 'object' || scenarios === null) {
            return;
        }

        for (const [ name, slot ] of Object.entries(scenarios)) {
            if (isResourceScenarioSlot(slot)) {
                recordScenario(resource, path, name, slot);
            }
        }
    }

    function visitDependencies(
        resource: AnyResourceDefinition,
        path: readonly string[],
        visitDependency: (dependency: AnyResourceDefinition, dependencyPath: readonly string[]) => void
    ): void {
        const dependencies: unknown = Reflect.get(resource, 'dependencies');

        if (typeof dependencies !== 'object' || dependencies === null) {
            return;
        }

        for (const key of Object.keys(dependencies)) {
            const property = Object.getOwnPropertyDescriptor(dependencies, key);
            const dependency: unknown = property?.value;

            if (isResourceDefinition(dependency)) {
                visitDependency(dependency, [ ...path, key ]);
            }
        }
    }

    function visit(resource: AnyResourceDefinition, path: readonly string[]): void {
        if (!visited.has(resource)) {
            visited.add(resource);
            recordOwnedScenarios(resource, path);
            visitDependencies(resource, path, visit);
        }
    }

    for (const [ key, resource ] of Object.entries(resources)) {
        visit(resource, [ key ]);
    }

    return owners;
}

export function bindResourceScenarios(
    resource: AnyResourceDefinition,
    bindings: ResolvedResourceScenarioBindings
): AnyResourceDefinition {
    const bound = Object.freeze({ ...resource });

    boundResourceScenarios.set(bound, bindings);

    return bound;
}

export function resolvedResourceScenarioBindings(
    resource: AnyResourceDefinition
): ResolvedResourceScenarioBindings {
    return boundResourceScenarios.get(resource) ?? defaultScenarioBindings(resource.scenarios);
}
