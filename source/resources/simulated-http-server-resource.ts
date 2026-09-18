import {
    startSimulatedHttpServer,
    type SimulatedHttpServerHandle
} from '../simulation/simulated-http-server.ts';
import type {
    SimulatedHttpServerDefinition,
    SimulationScenarioCatalog
} from '../simulation/simulation.ts';
import {
    defineLocalServiceResource,
    type EmptyResourceDependencies,
    type ResourceDefinition
} from './resources.ts';

export type SimulatedHttpServerResourceOptions<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = {
    readonly host?: string;
    readonly port?: number;
    readonly simulation: SimulatedHttpServerDefinition<Name, Scenarios>;
};

export type SimulatedHttpServerResource<
    Simulation extends {
        readonly name: string;
        readonly scenarios: SimulationScenarioCatalog;
    }
> = ResourceDefinition<
    Simulation['name'],
    SimulatedHttpServerHandle<Simulation>,
    EmptyResourceDependencies
>;

export function createSimulatedHttpServerResource<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerResourceOptions<Name, Scenarios>
): SimulatedHttpServerResource<SimulatedHttpServerDefinition<Name, Scenarios>> {
    const addressOptions = {
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(options.port === undefined ? {} : { port: options.port })
    };

    return defineLocalServiceResource({
        name: options.simulation.name,
        scope: 'per-case',
        requirements: [],
        ...addressOptions,
        async start(context) {
            context.signal.throwIfAborted();

            return await startSimulatedHttpServer({
                simulation: options.simulation,
                host: context.address.host,
                port: context.address.port
            });
        },
        async dispose(handle) {
            await handle.dispose();
        }
    });
}
