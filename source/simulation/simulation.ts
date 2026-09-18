const simulationDefinitionBrand: unique symbol = Symbol('overkill.simulationDefinition');
const simulatedHttpServerDefinitionBrand: unique symbol = Symbol('overkill.simulatedHttpServerDefinition');
const descriptorNamePattern = /^[A-Za-z0-9._-]+$/u;

export type SimulationScenarioDescriptor = {
    readonly title: string;
};

export type SimulationScenarioCatalog = Readonly<Record<string, SimulationScenarioDescriptor>> & {
    readonly default: SimulationScenarioDescriptor;
};

export type SimulationDefinitionInput<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = {
    readonly name: Name;
    readonly scenarios: Scenarios;
};

export type SimulationDefinition<
    Name extends string = string,
    Scenarios extends SimulationScenarioCatalog = SimulationScenarioCatalog
> = SimulationDefinitionInput<Name, Scenarios> & {
    readonly kind: 'simulation';
    readonly [simulationDefinitionBrand]: true;
};

export type SimulationScenarioKey<Simulation> = Simulation extends {
    readonly scenarios: infer Scenarios extends SimulationScenarioCatalog;
} ? string & keyof Scenarios
    : never;

export type ScenarioKeyOf<Simulation> = SimulationScenarioKey<Simulation>;

export type SimulationScenarioFor<
    Simulation,
    Scenario extends SimulationScenarioKey<Simulation>
> = Simulation extends {
    readonly scenarios: infer Scenarios extends SimulationScenarioCatalog;
} ? Scenarios[Scenario]
    : never;

export type SimulatedHttpRequestScenario<
    Scenario extends string,
    Descriptor extends SimulationScenarioDescriptor
> = {
    readonly descriptor: Descriptor;
    readonly key: Scenario;
};

export type SimulatedHttpHandler<Scenarios extends SimulationScenarioCatalog> = <
    Scenario extends string & keyof Scenarios
>(
    request: Request,
    scenario: SimulatedHttpRequestScenario<Scenario, Scenarios[Scenario]>
) => Promise<Response> | Response;

export type SimulatedHttpServerDefinitionInput<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = SimulationDefinitionInput<Name, Scenarios> & {
    readonly handle: SimulatedHttpHandler<Scenarios>;
};

export type SimulatedHttpServerDefinition<
    Name extends string = string,
    Scenarios extends SimulationScenarioCatalog = SimulationScenarioCatalog
> = SimulatedHttpServerDefinitionInput<Name, Scenarios> & {
    readonly kind: 'simulated-http-server';
    readonly [simulationDefinitionBrand]: true;
    readonly [simulatedHttpServerDefinitionBrand]: true;
};

function assertDescriptorName(kind: string, name: string): void {
    if (!descriptorNamePattern.test(name)) {
        throw new TypeError(`${kind} "${name}" must match ${descriptorNamePattern.source}.`);
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertScenarioDescriptor(scenarioKey: string, descriptor: unknown): void {
    if (!isRecord(descriptor)) {
        throw new TypeError(`Simulation scenario "${scenarioKey}" must be an object.`);
    }

    if (typeof descriptor.title !== 'string' || descriptor.title.length === 0) {
        throw new TypeError(`Simulation scenario "${scenarioKey}" requires a non-empty title.`);
    }
}

function scenarioCatalogEntries(
    scenarios: unknown
): readonly (readonly [string, unknown])[] {
    if (!isRecord(scenarios)) {
        throw new TypeError('Simulation scenarios must be an object.');
    }

    const scenarioEntries = Object.entries(scenarios);

    if (scenarioEntries.length === 0) {
        throw new TypeError('Simulation scenarios must not be empty.');
    }

    if (!Object.hasOwn(scenarios, 'default')) {
        throw new TypeError('Simulation scenarios must include a "default" scenario.');
    }

    return scenarioEntries;
}

function freezeScenarioCatalog<Scenarios extends SimulationScenarioCatalog>(scenarios: Scenarios): Scenarios {
    const scenarioEntries = scenarioCatalogEntries(scenarios);

    for (const [ scenarioKey, descriptor ] of scenarioEntries) {
        assertDescriptorName('Simulation scenario', scenarioKey);
        assertScenarioDescriptor(scenarioKey, descriptor);
        Object.freeze(descriptor);
    }

    return Object.freeze(scenarios);
}

export function defineSimulation<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    definition: SimulationDefinitionInput<Name, Scenarios>
): SimulationDefinition<Name, Scenarios> {
    assertDescriptorName('Simulation', definition.name);

    return Object.freeze({
        name: definition.name,
        scenarios: freezeScenarioCatalog(definition.scenarios),
        kind: 'simulation',
        [simulationDefinitionBrand]: true as const
    });
}

export function defineSimulatedHttpServer<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    definition: SimulatedHttpServerDefinitionInput<Name, Scenarios>
): SimulatedHttpServerDefinition<Name, Scenarios> {
    if (typeof definition.handle !== 'function') {
        throw new TypeError('Simulated HTTP server requires a handler function.');
    }

    const simulation = defineSimulation(definition);

    return Object.freeze({
        name: simulation.name,
        scenarios: simulation.scenarios,
        handle: definition.handle,
        kind: 'simulated-http-server',
        [simulationDefinitionBrand]: true as const,
        [simulatedHttpServerDefinitionBrand]: true as const
    });
}

export function isDefinedSimulation(value: unknown): value is SimulationDefinition {
    return typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, simulationDefinitionBrand) === true;
}

export function isDefinedSimulatedHttpServer(value: unknown): value is SimulatedHttpServerDefinition {
    return isDefinedSimulation(value) &&
        Reflect.get(value, simulatedHttpServerDefinitionBrand) === true;
}
