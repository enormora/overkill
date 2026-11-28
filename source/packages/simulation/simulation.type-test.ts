import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import {
    acceptsCall,
    assignableFrom,
    assignableTo,
    rejectsCall,
    sameType
} from '@overkill-dev/type-test';
import { isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Simulation scenarios and planning', [
    suite('Simulation scenarios and observations', [
        test('preserves finite scenario keys and descriptors', function (scope) {
            scope.assert(sameType<ScenarioKeyOf<typeof simulation>, 'default' | 'outage'>());
            scope.assert(sameType<
                IsEqual<SimulationScenarioFor<typeof simulation, 'outage'>, {
                    readonly status: OutageStatus;
                    readonly title: 'upstream outage';
                }>,
                true
            >());
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<OutageStatus>()(simulation.scenarios.outage.status)
            );
            return scope.assert.collect();
        }),
        test('types simulated HTTP handlers from scenario catalogs', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<typeof httpSimulation.handle, SimulatedHttpHandler<typeof httpSimulation.scenarios>>,
                    true
                >()
            );
            scope.assert(acceptsCall, async function () {
                return httpSimulation.handle(new Request('https://example.test'), {
                    descriptor: httpSimulation.scenarios.default,
                    key: 'default'
                });
            });
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return httpSimulation.handle(new Request('https://example.test'), {
                        descriptor: httpSimulation.scenarios.default,
                        key: 'missing'
                    });
                }
            );
            return scope.assert.collect();
        }),
        test('requires a catalog key to launch a fixed server', function (scope) {
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<FixedSimulatedHttpServerHandle>>()(
                    startFixedSimulatedHttpServer({ simulation: httpSimulation, scenario: 'outage' })
                )
            );
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>({
                        simulation: httpSimulation
                    });
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return startFixedSimulatedHttpServer<typeof httpSimulation.name, typeof httpSimulation.scenarios>({
                        simulation: httpSimulation,
                        scenario: 'missing'
                    });
                }
            );
            scope.assert(assignableFrom.not<keyof FixedSimulatedHttpServerHandle, 'scenarioUrl'>());
            return scope.assert.collect();
        }),
        test('types launched simulated HTTP server handles from scenario catalogs', function (scope) {
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<SimulatedHttpServerHandle<typeof httpSimulation>>>()(
                    startSimulatedHttpServer({ simulation: httpSimulation })
                )
            );
            scope.assert(
                sameType<
                    IsEqual<
                        SimulatedHttpServerHandle<typeof httpSimulation>['scenarioUrl'],
                        (scenario: 'default' | 'outage', path: string) => string
                    >,
                    true
                >()
            );
            return scope.assert.collect();
        })
    ]),
    test('infers scenario keys and status in HTTP handlers', function (scope) {
        const simulationWithHandler = defineSimulatedHttpServer({
            name: 'http-api',
            scenarios: {
                default: { status: successStatus, title: 'standard responses' },
                outage: { status: outageStatus, title: 'upstream outage' }
            },
            handle(_request, scenario) {
                scope.assert(assignableTo.withActual<'default' | 'outage'>(), scenario.key);
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<OutageStatus | SuccessStatus>()(scenario.descriptor.status)
                );

                return Response.json({ status: scenario.descriptor.status });
            }
        });
        scope.assert(sameType<ScenarioKeyOf<typeof simulationWithHandler>, 'default' | 'outage'>());
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<SimulatedHttpHandler<typeof simulationWithHandler.scenarios>>()(simulationWithHandler.handle)
        );
        return scope.assert.collect();
    })
]);
