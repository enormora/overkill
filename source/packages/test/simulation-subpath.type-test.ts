import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('@overkill-dev/test/simulation', [
    test('exposes simulation definitions through the standard distribution', function (typeScope) {
        typeScope.assert(sameType<ScenarioKeyOf<typeof apiSimulation>, 'default' | 'outage'>());
        typeScope.assert(sameType<ScenarioKeyOf<typeof httpSimulation>, 'default' | 'outage'>());
        typeScope.assert(sameType.withActual<'api'>(), apiSimulation.name);
        typeScope.assert(acceptsCall, async () =>
            httpSimulation.handle(new Request('https://example.test'), {
                descriptor: httpSimulation.scenarios.outage,
                key: 'outage'
            }));
        return typeScope.assert.collect();
    })
]);
