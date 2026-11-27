import type { IsEqual } from 'type-fest';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
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
        return Response.json({ status: scenario.descriptor.status });
    }
});

export const testNode = suite('simulation', [
    suite('@overkill-dev/simulation', [
        test('preserves finite scenario keys and descriptors', function (typeScope) {
            typeScope.assert(sameType<ScenarioKeyOf<typeof simulation>, 'default' | 'outage'>());
            typeScope.assert(sameType<SimulationScenarioFor<typeof simulation, 'outage'>, {
                readonly status: OutageStatus;
                readonly title: 'upstream outage';
            }>());
            typeScope.assert(sameType.withActual<OutageStatus>(), simulation.scenarios.outage.status);
            return typeScope.assert.collect();
        }),
        test('types simulated HTTP handlers from scenario catalogs', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<typeof httpSimulation.handle, SimulatedHttpHandler<typeof httpSimulation.scenarios>>,
                    true
                >()
            );
            typeScope.assert(acceptsCall, () =>
                httpSimulation.handle(new Request('https://example.test'), {
                    descriptor: httpSimulation.scenarios.default,
                    key: 'default'
                }));
            typeScope.assert(
                rejectsCall('argument-type'),
                () =>
                    httpSimulation.handle(new Request('https://example.test'), {
                        descriptor: httpSimulation.scenarios.default,
                        key: 'missing'
                    })
            );
            return typeScope.assert.collect();
        }),
        test('requires a catalog key to launch a fixed server', function (typeScope) {
            typeScope.assert(
                sameType.withActual<Promise<FixedSimulatedHttpServerHandle>>(),
                startFixedSimulatedHttpServer({ simulation: httpSimulation, scenario: 'outage' })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () =>
                    startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>({
                        simulation: httpSimulation
                    })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () =>
                    startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>({
                        simulation: httpSimulation,
                        scenario: 'missing'
                    })
            );
            typeScope.assert(assignableFrom.not<keyof FixedSimulatedHttpServerHandle, 'scenarioUrl'>());
            return typeScope.assert.collect();
        }),
        test('types launched simulated HTTP server handles from scenario catalogs', function (typeScope) {
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<SimulatedHttpServerHandle<typeof httpSimulation>>>()(
                    startSimulatedHttpServer({ simulation: httpSimulation })
                )
            );
            typeScope.assert(
                sameType<
                    SimulatedHttpServerHandle<typeof httpSimulation>['scenarioUrl'],
                    (scenario: 'default' | 'outage', path: string) => string
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    test('infers scenario keys and status in HTTP handlers', function (typeScope) {
        defineSimulatedHttpServer({
            name: 'http-api',
            scenarios: {
                default: { status: successStatus, title: 'standard responses' },
                outage: { status: outageStatus, title: 'upstream outage' }
            },
            handle(_request, scenario) {
                typeScope.assert(sameType.withActual<'default' | 'outage'>(), scenario.key);
                typeScope.assert(sameType.withActual<OutageStatus | SuccessStatus>(), scenario.descriptor.status);

                return Response.json({ status: scenario.descriptor.status });
            }
        });
        return typeScope.assert.collect();
    })
]);
