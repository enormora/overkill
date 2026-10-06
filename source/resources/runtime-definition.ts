import type { ExecutionRequirement, RuntimeResourceMap } from './resource-definition-shape.ts';
import {
    resourceScenarioOwners,
    type ResourceMapScenarioSlots,
    type ResourceScenarioOwner
} from './resource-scenario-binding.ts';
import type {
    ResourceScenarioSlots,
    ScenarioBindingInput
} from './resource-scenario.ts';

const runtimeDefinitionBrand: unique symbol = Symbol.for('overkill.runtimeDefinition');

export type RuntimeDimensions = Readonly<Record<string, string>>;
type RuntimeScenarioBindings = Readonly<Record<string, string>>;

export type RuntimeId<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions
> = {
    readonly name: Name;
    readonly scenarios: RuntimeScenarioBindings;
    readonly dimensions: Dimensions;
    readonly variantId: string | null;
};

export type RuntimeDefinitionInput<
    Name extends string,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = {
    readonly dimensions: Dimensions;
    readonly name: Name;
    readonly requirements: readonly ExecutionRequirement[];
    readonly resources: Resources;
};

export type RuntimeScenarioOwner = ResourceScenarioOwner & {
    readonly value: string;
};

type RuntimeScenarioMethod<
    Name extends string,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap,
    Scenarios extends ResourceScenarioSlots
> = <
    const Bindings extends Readonly<Record<string, string>>
>(bindings: Bindings & ScenarioBindingInput<Scenarios, Bindings>) => RuntimeDefinition<
    Name,
    Dimensions,
    Resources,
    Scenarios
>;

export type RuntimeDefinition<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions,
    Resources extends RuntimeResourceMap = RuntimeResourceMap,
    Scenarios extends ResourceScenarioSlots = ResourceScenarioSlots
> = RuntimeDefinitionInput<Name, Dimensions, Resources> & {
    readonly id: RuntimeId<Name, Dimensions>;
    readonly kind: 'runtime';
    readonly scenario: RuntimeScenarioMethod<Name, Dimensions, Resources, Scenarios>;
    readonly scenarios: Scenarios;
    readonly [runtimeDefinitionBrand]: true;
};

const runtimeScenarioOwners = new WeakMap<RuntimeDefinition, ReadonlyMap<string, RuntimeScenarioOwner>>();

function scenarioSlots(owners: ReadonlyMap<string, ResourceScenarioOwner>): ResourceScenarioSlots {
    return Object.freeze(Object.fromEntries(
        Array.from(owners, function scenarioEntry([ name, owner ]) {
            return [ name, owner.slot ];
        })
    ));
}

function resolveScenarioOwners(
    owners: ReadonlyMap<string, ResourceScenarioOwner>,
    current: Readonly<Record<string, string>>,
    overrides: Readonly<Record<string, string>>
): ReadonlyMap<string, RuntimeScenarioOwner> {
    for (const [ name, value ] of Object.entries(overrides)) {
        const owner = owners.get(name);

        if (owner === undefined) {
            throw new TypeError(`Runtime scenario slot "${name}" is not declared.`);
        }

        if (!owner.slot.values.includes(value)) {
            throw new TypeError(`Runtime scenario slot "${name}" does not declare value "${value}".`);
        }
    }

    return new Map(Array.from(owners, function resolvedOwner([ name, owner ]) {
        return [ name, {
            ...owner,
            value: overrides[name] ?? current[name] ?? owner.slot.default
        } ];
    }));
}

function ownerBindings(owners: ReadonlyMap<string, RuntimeScenarioOwner>): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(
        Array.from(owners, function bindingEntry([ name, owner ]) {
            return [ name, owner.value ];
        })
    ));
}

function createRuntimeDefinition(
    definition: RuntimeDefinitionInput<string, RuntimeDimensions, RuntimeResourceMap>,
    bindings: Readonly<Record<string, string>>
): RuntimeDefinition {
    const owners = resourceScenarioOwners(definition.resources);
    const slots = scenarioSlots(owners);
    const resolvedOwners = resolveScenarioOwners(owners, {}, bindings);
    const scenario = function bindRuntimeScenario(
        overrides: Readonly<Record<string, string>>
    ): RuntimeDefinition {
        return createRuntimeDefinition(definition, {
            ...ownerBindings(resolvedOwners),
            ...overrides
        });
    };

    const descriptor: RuntimeDefinition = Object.freeze({
        ...definition,
        id: Object.freeze({
            name: definition.name,
            dimensions: definition.dimensions,
            scenarios: ownerBindings(resolvedOwners),
            variantId: null
        }),
        kind: 'runtime',
        scenario,
        scenarios: slots,
        [runtimeDefinitionBrand]: true as const
    });
    runtimeScenarioOwners.set(descriptor, resolvedOwners);

    return descriptor;
}

export function defineRuntime<
    const Name extends string,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap
>(
    definition: RuntimeDefinitionInput<Name, Dimensions, Resources>
): RuntimeDefinition<Name, Dimensions, Resources, ResourceMapScenarioSlots<Resources>>;
export function defineRuntime(
    definition: RuntimeDefinitionInput<string, RuntimeDimensions, RuntimeResourceMap>
): RuntimeDefinition {
    return createRuntimeDefinition(definition, {});
}

export function resolvedRuntimeScenarioOwners(runtime: RuntimeDefinition): ReadonlyMap<string, RuntimeScenarioOwner> {
    return runtimeScenarioOwners.get(runtime) ?? new Map();
}

export function isDefinedRuntime(runtime: unknown): runtime is RuntimeDefinition {
    return typeof runtime === 'object' &&
        runtime !== null &&
        Reflect.get(runtime, runtimeDefinitionBrand) === true;
}
