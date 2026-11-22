import { type TestNode, suite, test } from '@overkill-dev/test';

import { simulatedHttpListener, simulatedListenerScenario } from '../test-support/simulated-http-listener.ts';
import { defineSimulatedHttpServer } from './simulation.ts';
import { assertNoSimulatedHttpHandlerErrors, listenToSimulatedHttpServer } from './simulated-http-server.ts';

const simulation = defineSimulatedHttpServer({
    name: 'unit-server',
    scenarios: { default: { title: 'available' }, offline: { title: 'unavailable' } },
    handle() {
        return new Response('unit');
    }
});
export const testNode: TestNode = suite('simulated HTTP listener ownership', [
    test('rejects unbranded definitions before creating a listener', async function (scope) {
        const fixture = simulatedHttpListener(simulatedListenerScenario);
        await scope.assert.rejects(async function () {
            await Reflect.apply(listenToSimulatedHttpServer, undefined, [ {
                simulation: { name: simulation.name, scenarios: simulation.scenarios, handle: simulation.handle }
            }, function () {
                return fixture.listening;
            } ]);
        }, { message: 'startSimulatedHttpServer() requires a simulated HTTP server definition.' });
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test('exposes routed URLs and closes once across repeated disposal', async function (scope) {
        const fixture = simulatedHttpListener(simulatedListenerScenario);
        await using server = await listenToSimulatedHttpServer({ simulation }, function () {
            return fixture.listening;
        });
        scope.assert.equal(server.baseUrl, 'http://127.0.0.1:1234/default/');
        scope.assert.equal(
            server.scenarioUrl('offline', '/path?q=1'),
            'http://127.0.0.1:1234/offline/path?q=1'
        );
        scope.assert.equal(server.transcript, fixture.listening.transcript);
        scope.assert.true(Object.isFrozen(server));
        await Promise.all([ server.dispose(), server.dispose() ]);
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        scope.assert.equal(fixture.emitter.listenerCount('error'), 0);
        return scope.assert.collect();
    }),
    test('uses explicit listen addresses', async function (scope) {
        const fixture = simulatedHttpListener(simulatedListenerScenario);
        const server = await listenToSimulatedHttpServer(
            { simulation, host: 'localhost', port: 42 },
            function () {
                return fixture.listening;
            }
        );
        scope.assert.equal(server.baseUrl, 'http://localhost:1234/default/');
        await server.dispose();
        scope.assert.deepEqual(fixture.calls, [ 'listen:localhost:42', 'close' ]);
        return scope.assert.collect();
    }),
    test('formats IPv6 listen addresses as routed URLs', async function (scope) {
        const fixture = simulatedHttpListener(simulatedListenerScenario);
        await using server = await listenToSimulatedHttpServer({ simulation, host: '::1' }, function () {
            return fixture.listening;
        });
        scope.assert.equal(server.baseUrl, 'http://[::1]:1234/default/');
        return scope.assert.collect();
    }),
    test('propagates startup failures and unregisters the ready listener', async function (scope) {
        const failure = new Error('Listen failed.');
        const fixture = simulatedHttpListener({ ...simulatedListenerScenario, listenError: failure });
        await scope.assert.rejects(async function () {
            return listenToSimulatedHttpServer({ simulation }, function () {
                return fixture.listening;
            });
        }, {
            exact: failure
        });
        scope.assert.equal(fixture.emitter.listenerCount('listening'), 0);
        return scope.assert.collect();
    }),
    test('rejects missing TCP addresses', async function (scope) {
        const fixture = simulatedHttpListener({ ...simulatedListenerScenario, address: null });
        await scope.assert.rejects(async function () {
            return listenToSimulatedHttpServer({ simulation }, function () {
                return fixture.listening;
            });
        }, {
            message: 'Simulated HTTP server did not expose a TCP address.'
        });
        return scope.assert.collect();
    }),
    test('propagates close failures on every disposal without closing twice', async function (scope) {
        const failure = new Error('Close failed.');
        const fixture = simulatedHttpListener({ ...simulatedListenerScenario, closeError: failure });
        const server = await listenToSimulatedHttpServer({ simulation }, function () {
            return fixture.listening;
        });
        await scope.assert.rejects(async function () {
            return server.dispose();
        }, { exact: failure });
        await scope.assert.rejects(async function () {
            return server.dispose();
        }, { exact: failure });
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        return scope.assert.collect();
    }),
    test('reports retained handler errors after closing the server', async function (scope) {
        const failure = new Error('Handler failed.');
        const fixture = simulatedHttpListener({ ...simulatedListenerScenario, handlerErrors: [ failure ] });
        const server = await listenToSimulatedHttpServer({ simulation }, function () {
            return fixture.listening;
        });
        await scope.assert.rejects(async function () {
            return server.dispose();
        }, { exact: failure });
        scope.assert.throws(function () {
            assertNoSimulatedHttpHandlerErrors([ failure ]);
        }, { exact: failure });
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        return scope.assert.collect();
    }),
    test('normalizes nonerror handler failures', async function (scope) {
        const fixture = simulatedHttpListener({ ...simulatedListenerScenario, handlerErrors: [ 'failed' ] });
        const server = await listenToSimulatedHttpServer({ simulation }, function () {
            return fixture.listening;
        });
        await scope.assert.rejects(async function () {
            return server.dispose();
        }, {
            message: 'Simulation handler failed with a non-error value.',
            cause: { exact: 'failed' }
        });
        assertNoSimulatedHttpHandlerErrors([]);
        return scope.assert.collect();
    })
]);
