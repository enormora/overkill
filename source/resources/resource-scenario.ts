export type ScenarioTiming = 'acquire' | 'request-routed';

export type ResourceScenarioSlot<Scenario extends string = string> = {
    readonly default: Scenario;
    readonly timing: ScenarioTiming;
    readonly values: readonly [Scenario, ...(readonly Scenario[])];
};

export type ResourceScenarioSlotInput<Scenario extends string = string> = {
    readonly default: Scenario;
    readonly timing: ScenarioTiming;
    readonly values: readonly Scenario[];
};

export type ResourceScenarioSlotInputs = Readonly<Record<string, ResourceScenarioSlotInput>>;
export type ResourceScenarioSlotsFromInputs<Inputs extends ResourceScenarioSlotInputs> = {
    readonly [Slot in keyof Inputs]: ResourceScenarioSlot<
        Inputs[Slot]['default'] | Inputs[Slot]['values'][number]
    >;
};

export type ResourceScenarioSlots = Readonly<Record<string, ResourceScenarioSlot>>;
export type EmptyResourceScenarioSlots = Readonly<Record<PropertyKey, never>>;

export type ResourceScenarioBindings<Scenarios extends ResourceScenarioSlots> = {
    readonly [Slot in keyof Scenarios]: Scenarios[Slot]['values'][number];
};

export type ScenarioBindingInput<
    Scenarios extends ResourceScenarioSlots,
    Bindings extends Readonly<Record<string, string>>
> = {
    readonly [Slot in keyof Bindings]: Slot extends keyof Scenarios
        ? Bindings[Slot] extends Scenarios[Slot]['values'][number] ? Bindings[Slot] : never
        : never;
};

export type ResolvedResourceScenarioBindings = Readonly<Record<string, string>>;

const descriptorNamePattern = /^[A-Za-z0-9._-]+$/u;

function isScenarioTiming(value: unknown): value is ScenarioTiming {
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

function assertScenarioSlotName(name: string): void {
    if (!descriptorNamePattern.test(name)) {
        throw new TypeError(`Scenario slot "${name}" must match ${descriptorNamePattern.source}.`);
    }
}

function assertScenarioSlot(name: string, slot: ResourceScenarioSlot): void {
    assertScenarioSlotName(name);

    if (slot.values.length === 0) {
        throw new TypeError(`Scenario slot "${name}" requires at least one value.`);
    }

    const values = new Set(slot.values);

    if (values.size !== slot.values.length) {
        throw new TypeError(`Scenario slot "${name}" contains duplicate values.`);
    }

    if (!values.has(slot.default)) {
        throw new TypeError(`Scenario slot "${name}" default "${slot.default}" is not declared.`);
    }
}

export function freezeResourceScenarioSlots(scenarios: unknown): ResourceScenarioSlots {
    if (typeof scenarios !== 'object' || scenarios === null) {
        throw new TypeError('Resource scenarios must be an object.');
    }

    const entries = Object.entries(scenarios).map(function freezeScenarioEntry([ name, slot ]) {
        if (!isResourceScenarioSlot(slot)) {
            throw new TypeError(`Scenario slot "${name}" is invalid.`);
        }

        assertScenarioSlot(name, slot);
        const [ firstValue, ...remainingValues ] = slot.values;

        return [
            name,
            Object.freeze({
                default: slot.default,
                timing: slot.timing,
                values: Object.freeze([ firstValue, ...remainingValues ] as const)
            })
        ] as const;
    });

    return Object.freeze(Object.fromEntries(entries));
}

export function defaultScenarioBindings(
    scenarios: ResourceScenarioSlots
): ResolvedResourceScenarioBindings {
    return Object.freeze(Object.fromEntries(
        Object.entries(scenarios).map(function defaultScenarioEntry([ name, slot ]) {
            return [ name, slot.default ];
        })
    ));
}
