import { suite, test } from '@overkill-dev/test';

import { simulatedHttpRequest } from '../test-support/simulated-http-request.ts';

import { defineSimulatedHttpServer } from './simulation.ts';

const simulation = defineSimulatedHttpServer({
    name: 'service',
    scenarios: { default: { title: 'available', status: 200 }, unavailable: { title: 'unavailable', status: 503 } },
    async handle(request, scenario) {
        return Response.json({
            url: request.url,
            method: request.method,
            body: await request.text(),
            headers: Array.from(request.headers),
            scenario: scenario.key
        }, { status: scenario.descriptor.status });
    }
});
function responseText(body: Uint8Array | string | null): string {
    const decoder = new TextDecoder();
    return typeof body === 'string' ? body : decoder.decode(body ?? new Uint8Array());
}
export const testNode = suite('simulated HTTP request routing', [
    test('retains both handler failures and failures writing the error response', async function (scope) {
        const failure = new Error('Handler failed.');
        const responseFailure = new Error('Response closed.');
        const fixture = simulatedHttpRequest(
            scope,
            defineSimulatedHttpServer({
                name: 'failure',
                scenarios: { default: { title: 'failure' } },
                handle() {
                    throw failure;
                }
            })
        );
        fixture.failResponse(responseFailure);
        await fixture.serve();
        scope.assert.deepEqual(fixture.errors, [ failure, responseFailure ]);
        scope.assert.equal(fixture.response.status, null);
        return scope.assert.collect();
    }),
    test('rejects an incoming request with no scenario prefix', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        Reflect.deleteProperty(fixture.request, 'url');
        await fixture.serve();
        scope.assert.equal(fixture.response.status, 400);
        scope.assert.equal(responseText(fixture.response.body), 'Missing simulation scenario.');
        const entry = fixture.transcript.firstEntry;
        const interaction = entry?.[0] === 'http' ? entry[1] : null;
        scope.assert.deepEqual({ context: interaction?.context, url: interaction?.request.url }, {
            context: { scenario: null },
            url: 'https://service.test:42/'
        });
        scope.assert.deepEqual(fixture.errors, []);
        return scope.assert.collect();
    }),
    test('uses GET without consuming a body when an incoming method is absent', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        Reflect.deleteProperty(fixture.request, 'method');
        const pending = fixture.serve();
        fixture.request.emit('end');
        await pending;
        scope.assert.includes(responseText(fixture.response.body), '"method":"GET"');
        scope.assert.deepEqual(fixture.errors, []);
        return scope.assert.collect();
    }),
    test('accepts portable request bytes and scalar or repeated headers', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.method = 'POST';
        fixture.request.headers = { 'x-one': 'one', 'x-repeat': [ 'a', 'b' ], unused: undefined };
        const pending = fixture.serve();
        fixture.request.emit('data', Uint8Array.of(65, 66));
        fixture.request.emit('end');
        await pending;
        scope.assert.deepEqual<unknown, unknown>(JSON.parse(responseText(fixture.response.body)), {
            url: 'https://service.test:42/resource',
            method: 'POST',
            body: 'AB',
            headers: [ [ 'x-one', 'one' ], [ 'x-repeat', 'a, b' ] ],
            scenario: 'default'
        });
        scope.assert.deepEqual(fixture.errors, []);
        return scope.assert.collect();
    }),
    test('routes the default scenario and records its response', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        await fixture.serve();
        scope.assert.equal(fixture.response.status, 200);
        scope.assert.deepEqual<unknown, unknown>(JSON.parse(responseText(fixture.response.body)), {
            url: 'https://service.test:42/resource',
            method: 'GET',
            body: '',
            headers: [],
            scenario: 'default'
        });
        scope.assert.equal(fixture.transcript.entryCount, 1);
        scope.assert.deepEqual(fixture.errors, []);
        return scope.assert.collect();
    }),
    test('removes scenario selection from the request delivered to the handler', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.url = '/unavailable/resource?value=one&__overkill_scenario=default';
        await fixture.serve();
        scope.assert.equal(fixture.response.status, 503);
        scope.assert.deepEqual<unknown, unknown>(JSON.parse(responseText(fixture.response.body)), {
            url: 'https://service.test:42/resource?value=one&__overkill_scenario=default',
            method: 'GET',
            body: '',
            headers: [],
            scenario: 'unavailable'
        });
        scope.assert.equal(fixture.transcript.entryCount, 1);
        return scope.assert.collect();
    }),
    test('rejects unknown scenarios without invoking a handler', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.url = '/missing/';
        await fixture.serve();
        scope.assert.equal(fixture.response.status, 400);
        scope.assert.equal(responseText(fixture.response.body), 'Unknown simulation scenario.');
        scope.assert.deepEqual(fixture.errors, []);
        const entry = fixture.transcript.firstEntry;
        const interaction = entry?.[0] === 'http' ? entry[1] : null;
        scope.assert.deepEqual({ context: interaction?.context, url: interaction?.request.url }, {
            context: { scenario: 'missing' },
            url: 'https://service.test:42/missing/'
        });
        return scope.assert.collect();
    }),
    test('combines incoming body chunks and repeated headers', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.method = 'POST';
        fixture.request.headers = { 'x-values': [ 'one', 'two' ], unused: undefined };
        const completion = fixture.serve();
        fixture.request.emit('data', Buffer.from('first'));
        fixture.request.emit('data', Buffer.from('second'));
        fixture.request.emit('end');
        await completion;
        scope.assert.deepEqual<unknown, unknown>(JSON.parse(responseText(fixture.response.body)), {
            url: 'https://service.test:42/resource',
            method: 'POST',
            body: 'firstsecond',
            headers: [ [ 'x-values', 'one, two' ] ],
            scenario: 'default'
        });
        return scope.assert.collect();
    }),
    test('does not read a HEAD request body', async function (scope) {
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.method = 'HEAD';
        await fixture.serve();
        scope.assert.includes(responseText(fixture.response.body), '"method":"HEAD"');
        scope.assert.deepEqual(fixture.errors, []);
        return scope.assert.collect();
    }),
    test('reports handler failures and records error evidence', async function (scope) {
        const failure = new Error('Handler failed.');
        const fixture = simulatedHttpRequest(
            scope,
            defineSimulatedHttpServer({
                name: 'failure',
                scenarios: { default: { title: 'failure' } },
                handle() {
                    throw failure;
                }
            })
        );
        await fixture.serve();
        scope.assert.equal(fixture.response.status, 500);
        scope.assert.equal(responseText(fixture.response.body), 'Simulation handler failed.');
        scope.assert.deepEqual(fixture.errors, [ failure ]);
        scope.assert.equal(fixture.transcript.entryCount, 1);
        return scope.assert.collect();
    }),
    test('reports request stream failures without claiming a completed interaction', async function (scope) {
        const failure = new Error('Request failed.');
        const fixture = simulatedHttpRequest(scope.cleanup, simulation);
        fixture.request.method = 'POST';
        const completion = fixture.serve();
        fixture.request.emit('error', failure);
        await completion;
        scope.assert.equal(fixture.response.status, 500);
        scope.assert.deepEqual(fixture.errors, [ failure ]);
        scope.assert.equal(fixture.transcript.entryCount, 0);
        return scope.assert.collect();
    })
]);
