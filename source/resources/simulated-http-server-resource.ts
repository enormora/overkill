import {
    assertNoSimulatedHttpHandlerErrors,
    createSimulatedHttpListeningServer
} from '../packages/simulation/http.entry-point.ts';
import type {
    SimulatedHttpServerDefinition,
    SimulationScenarioCatalog
} from '../packages/simulation/simulation.entry-point.ts';
import type { HttpTranscript } from '../transcript/http-transcript.ts';
import {
    defineResource,
    type EmptyResourceDependencies,
    type ResourceDefinition
} from './resources.ts';
import type { ResourceScenarioSlot, ResourceScenarioSlotInput } from './resource-scenario.ts';
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
    readonly transcript: HttpTranscript<{ readonly scenario: string; }>;
};

type SimulatedHttpLocalService = LocalHttpServiceHandle & {
    readonly transcript: HttpTranscript<{ readonly scenario: string; }>;
};

export type SimulatedHttpServerResource<
    Simulation extends {
        readonly name: string;
        readonly scenarios: SimulationScenarioCatalog;
    }
> = ResourceDefinition<
    Simulation['name'],
    SimulatedHttpServerResourceHandle<Simulation>,
    EmptyResourceDependencies,
    SimulatedHttpServerResourceHandle<Simulation>,
    Readonly<
        Record<
            Simulation['name'],
            ResourceScenarioSlot<string & keyof Simulation['scenarios'], 'request-routed'>
        >
    >
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
    service: SimulatedHttpLocalService,
    scenario: string & keyof Simulation['scenarios']
): SimulatedHttpServerResourceHandle<Simulation> {
    return Object.freeze({
        baseUrl: scenario === 'default' ? service.baseUrl : scenarioUrl(service.baseUrl, scenario, '/'),
        endpoint: service.endpoint,
        transcript: service.transcript,
        scenarioUrl(requestedScenario: string & keyof Simulation['scenarios'], path: string) {
            return scenarioUrl(service.baseUrl, requestedScenario, path);
        }
    });
}

function selectedScenario(context: Readonly<Record<string, unknown>>, name: string): string {
    const scenarios: unknown = Reflect.get(context, 'scenarios');

    if (typeof scenarios !== 'object' || scenarios === null) {
        return 'default';
    }

    const selected: unknown = Reflect.get(scenarios, name);

    return typeof selected === 'string' ? selected : 'default';
}

function simulatedHttpScenarioSlots<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
>(
    name: Name,
    simulationScenarios: Scenarios
): Readonly<Record<Name, ResourceScenarioSlotInput<string & keyof Scenarios, 'request-routed'>>> {
    const values: [string & keyof Scenarios, ...(string & keyof Scenarios)[]] = [ 'default' ];

    for (const scenarioName in simulationScenarios) {
        if (scenarioName !== 'default') {
            values.push(scenarioName);
        }
    }

    const slots: Record<string, ResourceScenarioSlotInput<string & keyof Scenarios, 'request-routed'>> = {
        [name]: {
            default: 'default',
            timing: 'request-routed',
            values
        }
    };

    return Object.freeze(slots);
}

export function createSimulatedHttpServerResource<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerResourceOptions<Name, Scenarios>
): SimulatedHttpServerResource<SimulatedHttpServerDefinition<Name, Scenarios>> {
    const handlerErrors = new WeakMap<LocalHttpServer, readonly unknown[]>();
    const transcripts = new WeakMap<LocalHttpServer, SimulatedHttpLocalService['transcript']>();
    const acquiredServices = new WeakMap<
        SimulatedHttpServerResourceHandle<SimulatedHttpServerDefinition<Name, Scenarios>>,
        SimulatedHttpLocalService
    >();
    const service = createLocalHttpServiceResource({
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
            transcripts.set(listeningServer.server, listeningServer.transcript);

            return listeningServer.server;
        },
        handle(localService, server): SimulatedHttpLocalService {
            const transcript = transcripts.get(server);

            if (transcript === undefined) {
                throw new TypeError('Simulated HTTP server transcript is unavailable.');
            }

            return Object.freeze({ ...localService, transcript });
        },
        dispose(server) {
            assertNoSimulatedHttpHandlerErrors(handlerErrors.get(server) ?? []);
        }
    }, {
        kind: 'custom',
        transcript(server) {
            const transcript = transcripts.get(server);

            if (transcript === undefined) {
                throw new TypeError('Simulated HTTP server transcript is unavailable.');
            }

            return transcript;
        }
    });
    const scenarios = simulatedHttpScenarioSlots(options.simulation.name, options.simulation.scenarios);

    return defineResource({
        name: options.simulation.name,
        scope: 'per-case',
        requirements: service.requirements,
        scenarios,
        async acquire(context) {
            const localService = await service.acquire({
                dependencies: context.dependencies,
                signal: context.signal,
                scenarios: {}
            });
            const handle = simulatedHttpServerResourceHandle<SimulatedHttpServerDefinition<Name, Scenarios>>(
                localService,
                'default'
            );

            acquiredServices.set(handle, localService);

            return handle;
        },
        async dispose(handle, context) {
            const localService = acquiredServices.get(handle);

            if (localService === undefined) {
                return undefined;
            }

            acquiredServices.delete(handle);

            return service.dispose?.(localService, {
                dependencies: context.dependencies,
                signal: context.signal,
                scenarios: {}
            });
        },
        exposeHandle(handle, context) {
            return simulatedHttpServerResourceHandle<SimulatedHttpServerDefinition<Name, Scenarios>>(
                handle,
                selectedScenario(context, options.simulation.name)
            );
        }
    });
}
