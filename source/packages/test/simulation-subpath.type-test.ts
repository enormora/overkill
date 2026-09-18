import { describe, expect, test } from 'tstyche';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type ScenarioKeyOf
} from './simulation.entry-point.ts';

const successStatus = 200;
const outageStatus = 503;
const apiSimulation = defineSimulation({
    name: 'api',
    scenarios: {
        default: { title: 'standard responses' },
        outage: { title: 'upstream outage' }
    }
});
const httpSimulation = defineSimulatedHttpServer({
    name: 'http-api',
    scenarios: {
        default: { status: successStatus, title: 'standard responses' },
        outage: { status: outageStatus, title: 'upstream outage' }
    },
    handle(_request, scenario) {
        return Response.json({ status: scenario.descriptor.status });
    }
});

describe('@overkill-dev/test/simulation', function () {
    test('exposes simulation definitions through the standard distribution', function () {
        expect<ScenarioKeyOf<typeof apiSimulation>>().type.toBe<'default' | 'outage'>();
        expect<ScenarioKeyOf<typeof httpSimulation>>().type.toBe<'default' | 'outage'>();
        expect(apiSimulation.name).type.toBe<'api'>();
        expect(httpSimulation.handle).type.toBeCallableWith(new Request('https://example.test'), {
            descriptor: httpSimulation.scenarios.outage,
            key: 'outage'
        });
    });
});
