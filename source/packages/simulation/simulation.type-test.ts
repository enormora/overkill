import { describe, expect, test } from 'tstyche';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type ScenarioKeyOf,
    type SimulatedHttpHandler,
    type SimulationScenarioFor
} from './simulation.entry-point.ts';
import {
    startSimulatedHttpServer,
    type SimulatedHttpServerHandle
} from './http.entry-point.ts';

const simulation = defineSimulation({
    name: 'api',
    scenarios: {
        default: { status: 200, title: 'standard responses' },
        outage: { status: 503, title: 'upstream outage' }
    }
});
const httpSimulation = defineSimulatedHttpServer({
    name: 'http-api',
    scenarios: {
        default: { status: 200, title: 'standard responses' },
        outage: { status: 503, title: 'upstream outage' }
    },
    handle(_request, scenario) {
        expect(scenario.key).type.toBe<'default' | 'outage'>();
        expect(scenario.descriptor.status).type.toBe<200 | 503>();

        return Response.json({ status: scenario.descriptor.status });
    }
});

describe('@overkill-dev/simulation', function () {
    test('preserves finite scenario keys and descriptors', function () {
        expect<ScenarioKeyOf<typeof simulation>>().type.toBe<'default' | 'outage'>();
        expect<SimulationScenarioFor<typeof simulation, 'outage'>>().type.toBe<{
            readonly status: 503;
            readonly title: 'upstream outage';
        }>();
        expect(simulation.scenarios.outage.status).type.toBe<503>();
    });

    test('types simulated HTTP handlers from scenario catalogs', function () {
        expect<typeof httpSimulation.handle>().type.toBe<SimulatedHttpHandler<typeof httpSimulation.scenarios>>();
        expect(httpSimulation.handle).type.toBeCallableWith(new Request('http://example.test'), {
            descriptor: httpSimulation.scenarios.default,
            key: 'default'
        });
        expect(httpSimulation.handle).type.not.toBeCallableWith(new Request('http://example.test'), {
            descriptor: httpSimulation.scenarios.default,
            key: 'missing'
        });
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
