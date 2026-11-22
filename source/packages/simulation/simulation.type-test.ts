import { describe, expect, test } from 'tstyche';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type ScenarioKeyOf,
    type SimulatedHttpHandler,
    type SimulationScenarioFor
} from './simulation.entry-point.ts';
import {
    startFixedSimulatedHttpServer,
    startSimulatedHttpServer,
    type FixedSimulatedHttpServerHandle,
    type SimulatedHttpServerHandle
} from './http.entry-point.ts';

const successStatus = 200;
const outageStatus = 503;
type SuccessStatus = typeof successStatus;
type OutageStatus = typeof outageStatus;
const simulation = defineSimulation({
    name: 'api',
    scenarios: {
        default: { status: successStatus, title: 'standard responses' },
        outage: { status: outageStatus, title: 'upstream outage' }
    }
});
const httpSimulation = defineSimulatedHttpServer({
    name: 'http-api',
    scenarios: {
        default: { status: successStatus, title: 'standard responses' },
        outage: { status: outageStatus, title: 'upstream outage' }
    },
    handle(_request, scenario) {
        expect(scenario.key).type.toBe<'default' | 'outage'>();
        expect(scenario.descriptor.status).type.toBe<OutageStatus | SuccessStatus>();

        return Response.json({ status: scenario.descriptor.status });
    }
});

describe('@overkill-dev/simulation', function () {
    test('preserves finite scenario keys and descriptors', function () {
        expect<ScenarioKeyOf<typeof simulation>>().type.toBe<'default' | 'outage'>();
        expect<SimulationScenarioFor<typeof simulation, 'outage'>>().type.toBe<{
            readonly status: OutageStatus;
            readonly title: 'upstream outage';
        }>();
        expect(simulation.scenarios.outage.status).type.toBe<OutageStatus>();
    });

    test('types simulated HTTP handlers from scenario catalogs', function () {
        expect<typeof httpSimulation.handle>().type.toBe<SimulatedHttpHandler<typeof httpSimulation.scenarios>>();
        expect(httpSimulation.handle).type.toBeCallableWith(new Request('https://example.test'), {
            descriptor: httpSimulation.scenarios.default,
            key: 'default'
        });
        expect(httpSimulation.handle).type.not.toBeCallableWith(new Request('https://example.test'), {
            descriptor: httpSimulation.scenarios.default,
            key: 'missing'
        });
    });

    test('requires a catalog key to launch a fixed server', function () {
        expect(startFixedSimulatedHttpServer({ simulation: httpSimulation, scenario: 'outage' })).type.toBe<
            Promise<FixedSimulatedHttpServerHandle>
        >();
        expect(startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>)
            .type
            .not
            .toBeCallableWith({ simulation: httpSimulation });
        expect(startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>)
            .type
            .not
            .toBeCallableWith({ simulation: httpSimulation, scenario: 'missing' });
        expect<FixedSimulatedHttpServerHandle>().type.not.toHaveProperty('scenarioUrl');
    });

    test('types launched simulated HTTP server handles from scenario catalogs', function () {
        expect(startSimulatedHttpServer({ simulation: httpSimulation })).type.toBe<
            Promise<SimulatedHttpServerHandle<typeof httpSimulation>>
        >();
        expect<SimulatedHttpServerHandle<typeof httpSimulation>['scenarioUrl']>().type.toBe<
            (scenario: 'default' | 'outage', path: string) => string
        >();
    });
});
