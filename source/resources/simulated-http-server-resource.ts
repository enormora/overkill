import {
    assertNoSimulatedHttpHandlerErrors,
    createSimulatedHttpListeningServer
} from '../simulation/simulated-http-server.ts';
import type {
    SimulatedHttpServerDefinition,
    SimulationScenarioCatalog
} from '../simulation/simulation.ts';
import type {
    EmptyResourceDependencies,
    ResourceDefinition
} from './resources.ts';
import {
    createLocalHttpServiceResource,
    type LocalHttpServer,
    type LocalHttpServiceHandle
} from './local-http-service-resource.ts';
import type {
    LocalServiceAddressRequest
} from './local-service-resource.ts';

export type SimulatedHttpServerResourceOptions<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = {
    readonly address: LocalServiceAddressRequest;
    readonly simulation: SimulatedHttpServerDefinition<Name, Scenarios>;
};

export type SimulatedHttpServerResourceHandle<
    Simulation extends {
        readonly scenarios: SimulationScenarioCatalog;
    }
> = {
    readonly baseUrl: string;
    readonly endpoint: LocalHttpServiceHandle['endpoint'];
    readonly scenarioUrl: (scenario: string & keyof Simulation['scenarios'], path: string) => string;
};

export type SimulatedHttpServerResource<
    Simulation extends {
        readonly name: string;
        readonly scenarios: SimulationScenarioCatalog;
    }
> = ResourceDefinition<
    Simulation['name'],
    SimulatedHttpServerResourceHandle<Simulation>,
    EmptyResourceDependencies
>;

const scenarioQueryParameterName = '__overkill_scenario';

function scenarioUrl(baseUrl: string, scenario: string, path: string): string {
    const url = new URL(path, baseUrl);

    url.searchParams.set(scenarioQueryParameterName, scenario);

    return url.href;
}

function simulatedHttpServerResourceHandle<
    Simulation extends {
        readonly scenarios: SimulationScenarioCatalog;
    }
>(
    service: LocalHttpServiceHandle
): SimulatedHttpServerResourceHandle<Simulation> {
    return Object.freeze({
        baseUrl: service.baseUrl,
        endpoint: service.endpoint,
        scenarioUrl(scenario: string & keyof Simulation['scenarios'], path: string) {
            return scenarioUrl(service.baseUrl, scenario, path);
        }
    });
}

export function createSimulatedHttpServerResource<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerResourceOptions<Name, Scenarios>
): SimulatedHttpServerResource<SimulatedHttpServerDefinition<Name, Scenarios>> {
    const handlerErrors = new WeakMap<LocalHttpServer, readonly unknown[]>();

    return createLocalHttpServiceResource({
        name: options.simulation.name,
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: options.address,
        createServer(context) {
            context.signal.throwIfAborted();
            const listeningServer = createSimulatedHttpListeningServer(
                options.simulation,
                context.address.host
            );

            handlerErrors.set(listeningServer.server, listeningServer.errors);

            return listeningServer.server;
        },
        handle: simulatedHttpServerResourceHandle<SimulatedHttpServerDefinition<Name, Scenarios>>,
        dispose(server) {
            assertNoSimulatedHttpHandlerErrors(handlerErrors.get(server) ?? []);
        }
    });
}
