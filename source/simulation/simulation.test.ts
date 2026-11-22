import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import {
    defineSimulatedHttpServer,
    defineSimulation,
    isDefinedSimulatedHttpServer,
    isDefinedSimulation
} from './simulation.ts';

const assertSimulationDescriptor = defineCompositeAssertion({
    name: 'simulation descriptor',
    assert(check) {
        const simulation = defineSimulation({
            name: 'checkout-api',
            scenarios: {
                default: { status: 200, title: 'standard responses' },
                'payments-500': { status: 500, title: 'payment service fails' }
            }
        });
        return check.group([
            check.equal(simulation.kind, 'simulation'),
            check.equal(simulation.name, 'checkout-api'),
            check.equal(simulation.scenarios['payments-500'].status, 500),
            check.equal(Object.isFrozen(simulation), true),
            check.equal(Object.isFrozen(simulation.scenarios), true),
            check.equal(Object.isFrozen(simulation.scenarios.default), true),
            check.equal(isDefinedSimulation(simulation), true),
            check.equal(isDefinedSimulatedHttpServer(simulation), false)
        ]);
    }
});

const assertSimulatedHttpDescriptor = defineCompositeAssertion({
    name: 'simulated http descriptor',
    assert(check) {
        const simulation = defineSimulatedHttpServer({
            name: 'api',
            scenarios: {
                default: { status: 200, title: 'standard responses' },
                outage: { status: 503, title: 'upstream outage' }
            },
            handle(_request, scenario) {
                return Response.json({
                    key: scenario.key,
                    status: scenario.descriptor.status
                });
            }
        });
        return check.group([
            check.equal(simulation.kind, 'simulated-http-server'),
            check.equal(isDefinedSimulation(simulation), true),
            check.equal(isDefinedSimulatedHttpServer(simulation), true),
            check.equal(
                simulation.handle(new Request('https://example.test'), {
                    descriptor: simulation.scenarios.outage,
                    key: 'outage'
                }) instanceof Response,
                true
            )
        ]);
    }
});

const assertSimulationValidation = defineCompositeAssertion({
    name: 'simulation validation',
    assert(check) {
        return check.group([
            check.throws(function rejectInvalidName() {
                defineSimulation({
                    name: 'bad name',
                    scenarios: { default: { title: 'standard responses' } }
                });
            }, { message: 'Simulation "bad name" must match ^[A-Za-z0-9._-]+$.' }),
            check.throws(function rejectEmptyCatalog() {
                Reflect.apply(defineSimulation, undefined, [ {
                    name: 'api',
                    scenarios: {}
                } ]);
            }, { message: 'Simulation scenarios must not be empty.' }),
            check.throws(function rejectNonObjectCatalog() {
                Reflect.apply(defineSimulation, undefined, [ {
                    name: 'api',
                    scenarios: null
                } ]);
            }, { message: 'Simulation scenarios must be an object.' }),
            check.throws(function rejectMissingDefault() {
                Reflect.apply(defineSimulation, undefined, [ {
                    name: 'api',
                    scenarios: { outage: { title: 'upstream outage' } }
                } ]);
            }, { message: 'Simulation scenarios must include a "default" scenario.' }),
            check.throws(function rejectInvalidScenarioKey() {
                defineSimulation({
                    name: 'api',
                    scenarios: {
                        default: { title: 'standard responses' },
                        'bad key': { title: 'bad scenario' }
                    }
                });
            }, { message: 'Simulation scenario "bad key" must match ^[A-Za-z0-9._-]+$.' }),
            check.throws(function rejectInvalidScenarioDescriptor() {
                Reflect.apply(defineSimulation, undefined, [ {
                    name: 'api',
                    scenarios: { default: null }
                } ]);
            }, { message: 'Simulation scenario "default" must be an object.' }),
            check.throws(function rejectEmptyTitle() {
                defineSimulation({
                    name: 'api',
                    scenarios: { default: { title: '' } }
                });
            }, { message: 'Simulation scenario "default" requires a non-empty title.' }),
            check.throws(function rejectInvalidHttpHandler() {
                defineSimulatedHttpServer({
                    name: 'api',
                    scenarios: { default: { title: 'standard responses' } },
                    handle: null as unknown as () => Response
                });
            }, { message: 'Simulated HTTP server requires a handler function.' })
        ]);
    }
});

export const testNode = suite('Simulation runtimes', [
    test('simulation descriptors preserve finite typed scenario catalogs', function (scope) {
        scope.assert(assertSimulationDescriptor);

        return scope.assert.collect();
    }),
    test('simulated HTTP server descriptors expose typed handlers', function (scope) {
        scope.assert(assertSimulatedHttpDescriptor);

        return scope.assert.collect();
    }),
    test('simulation descriptors reject invalid catalogs', function (scope) {
        scope.assert(assertSimulationValidation);

        return scope.assert.collect();
    })
]);
