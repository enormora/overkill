import type { SimulatedHttpServerDefinition, SimulationScenarioCatalog } from './simulation.ts';

type ScenarioResponse = (request: Request) => Promise<Response> | Response;

export type ScenarioRoute<Scenario extends string | null> = {
    readonly url: URL;
    readonly scenario: Scenario;
    readonly respond: ScenarioResponse;
};

export type ScenarioRouting<Scenario extends string | null> = (url: URL) => ScenarioRoute<Scenario>;

export function assertRoutableScenarios(scenarios: SimulationScenarioCatalog): void {
    if (Object.hasOwn(scenarios, '.') || Object.hasOwn(scenarios, '..')) {
        throw new TypeError('Request-routed simulation scenario keys cannot be "." or "..".');
    }
}

export function simulatedHttpScenarioUrl(baseUrl: string, scenario: string, path: string): string {
    const { origin } = new URL(baseUrl);
    const url = new URL(path, origin);
    if (/^\s*(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/iu.test(path) || url.origin !== origin) {
        throw new TypeError('Simulation request paths must be relative to the server.');
    }

    url.pathname = `/${scenario}${url.pathname}`;

    return url.href;
}

function hasScenario<Scenarios extends SimulationScenarioCatalog>(
    scenarios: Scenarios,
    key: string
): key is string & keyof Scenarios {
    return Object.hasOwn(scenarios, key);
}

function scenarioHandler<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    key: string & keyof Scenarios
): ScenarioResponse {
    const descriptor = simulation.scenarios[key];

    return function respond(request): Promise<Response> | Response {
        return simulation.handle(request, { descriptor, key });
    };
}

export function fixedScenario<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    scenario: string & keyof Scenarios
): ScenarioRouting<string> {
    if (typeof scenario !== 'string' || !hasScenario(simulation.scenarios, scenario)) {
        throw new TypeError('Unknown fixed simulation scenario.');
    }

    const respond = scenarioHandler(simulation, scenario);

    return function routeRequest(url) {
        return { url, scenario, respond };
    };
}

export function requestRoutedScenario<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>
): ScenarioRouting<string | null> {
    return function routeRequest(url) {
        const keyStart = 1;
        const separator = url.pathname.indexOf('/', keyStart);
        if (separator <= keyStart) {
            return {
                url,
                scenario: null,
                respond() {
                    return new Response('Missing simulation scenario.', { status: 400 });
                }
            };
        }

        const scenario = url.pathname.slice(keyStart, separator);
        if (!hasScenario(simulation.scenarios, scenario)) {
            return {
                url,
                scenario,
                respond() {
                    return new Response('Unknown simulation scenario.', { status: 400 });
                }
            };
        }

        const applicationUrl = new URL(url);
        applicationUrl.pathname = url.pathname.slice(separator);

        return { url: applicationUrl, scenario, respond: scenarioHandler(simulation, scenario) };
    };
}
