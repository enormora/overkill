import { acceptsCall, sameType } from '../type-test/type-test.entry-point.ts';
import { suite, test } from './test.entry-point.ts';
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

export const testNode = suite('Simulation authoring exports', [
    test('exposes simulation definitions through the standard distribution', function (scope) {
        scope.assert(sameType<ScenarioKeyOf<typeof apiSimulation>, 'default' | 'outage'>());
        scope.assert(sameType<ScenarioKeyOf<typeof httpSimulation>, 'default' | 'outage'>());
        scope.assert(sameType.withActual<'api'>(), apiSimulation.name);
        scope.assert(acceptsCall, async function () {
            return httpSimulation.handle(new Request('https://example.test'), {
                descriptor: httpSimulation.scenarios.outage,
                key: 'outage'
            });
        });
        return scope.assert.collect();
    })
]);
