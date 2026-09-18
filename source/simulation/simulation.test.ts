import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    isDefinedSimulatedHttpServer,
    isDefinedSimulation
} from './simulation.ts';

function assertSimulationDescriptor(scope: TestScope): void {
    const simulation = defineSimulation({
        name: 'checkout-api',
        scenarios: {
            default: { status: 200, title: 'standard responses' },
            'payments-500': { status: 500, title: 'payment service fails' }
        }
    });

    scope.assert.equal(simulation.kind, 'simulation');
    scope.assert.equal(simulation.name, 'checkout-api');
    scope.assert.equal(simulation.scenarios['payments-500'].status, 500);
    scope.assert.equal(Object.isFrozen(simulation), true);
    scope.assert.equal(Object.isFrozen(simulation.scenarios), true);
    scope.assert.equal(Object.isFrozen(simulation.scenarios.default), true);
    scope.assert.equal(isDefinedSimulation(simulation), true);
    scope.assert.equal(isDefinedSimulatedHttpServer(simulation), false);
}

function assertSimulatedHttpDescriptor(scope: TestScope): void {
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

    scope.assert.equal(simulation.kind, 'simulated-http-server');
    scope.assert.equal(isDefinedSimulation(simulation), true);
    scope.assert.equal(isDefinedSimulatedHttpServer(simulation), true);
    scope.assert.equal(simulation.handle(new Request('http://example.test'), {
        descriptor: simulation.scenarios.outage,
        key: 'outage'
    }) instanceof Response, true);
}

function assertSimulationValidation(scope: TestScope): void {
    scope.assert.throws(function rejectInvalidName() {
        defineSimulation({
            name: 'bad name',
            scenarios: { default: { title: 'standard responses' } }
        });
    }, { message: 'Simulation "bad name" must match ^[A-Za-z0-9._-]+$.' });
    scope.assert.throws(function rejectEmptyCatalog() {
        defineSimulation({
            name: 'api',
            scenarios: {} as { readonly default: { readonly title: string; }; }
        });
    }, { message: 'Simulation scenarios must not be empty.' });
    scope.assert.throws(function rejectMissingDefault() {
        defineSimulation({
            name: 'api',
            scenarios: { outage: { title: 'upstream outage' } } as unknown as {
                readonly default: { readonly title: string; };
                readonly outage: { readonly title: string; };
            }
        });
    }, { message: 'Simulation scenarios must include a "default" scenario.' });
    scope.assert.throws(function rejectInvalidScenarioKey() {
        defineSimulation({
            name: 'api',
            scenarios: {
                default: { title: 'standard responses' },
                'bad key': { title: 'bad scenario' }
            }
        });
    }, { message: 'Simulation scenario "bad key" must match ^[A-Za-z0-9._-]+$.' });
    scope.assert.throws(function rejectEmptyTitle() {
        defineSimulation({
            name: 'api',
            scenarios: { default: { title: '' } }
        });
    }, { message: 'Simulation scenario "default" requires a non-empty title.' });
    scope.assert.throws(function rejectInvalidHttpHandler() {
        defineSimulatedHttpServer({
            name: 'api',
            scenarios: { default: { title: 'standard responses' } },
            handle: null as unknown as () => Response
        });
    }, { message: 'Simulated HTTP server requires a handler function.' });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/simulation/simulation.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulation descriptors preserve finite typed scenario catalogs',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertSimulationDescriptor(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server descriptors expose typed handlers',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertSimulatedHttpDescriptor(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulation descriptors reject invalid catalogs',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertSimulationValidation(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
