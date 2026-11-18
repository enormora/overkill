import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { httpObservationFixture, type HttpObservationFixture } from '../test-support/local-http-observation-fixture.ts';
import { httpTranscriptBodyByteLimit, type HttpInteraction } from '../transcript/http-transcript.ts';

const encoder = new TextEncoder();
function observedInteraction(fixture: HttpObservationFixture): HttpInteraction<null> {
    const entry = fixture.observer.transcript.firstEntry;
    if (entry?.[0] !== 'http') {
        throw new Error('Expected an HTTP interaction.');
    }
    return entry[1];
}
function captureMessages(fixture: HttpObservationFixture): readonly string[] {
    return fixture.observer.transcript.entries.flatMap(function captureMessage(entry) {
        return entry[0] === 'capture-error' ? [ entry[1].message ] : [];
    });
}
function startUndici(fixture: HttpObservationFixture): void {
    fixture.publish('undici:request:create', { request: fixture.request });
    fixture.start();
}
function completeUndici(fixture: HttpObservationFixture, response: unknown, body: Uint8Array): void {
    fixture.finish();
    fixture.publish('undici:request:headers', { request: fixture.request, response });
    fixture.publish('undici:request:bodyChunkReceived', { request: fixture.request, chunk: body });
    fixture.publish('undici:request:trailers', { request: fixture.request });
}
const invalidResponses = [
    { response: { statusCode: '200', headers: [] }, message: 'Undici diagnostics response metadata is unavailable.' },
    {
        response: { statusCode: 200, statusText: 1, headers: [] },
        message: 'Undici diagnostics response metadata is unavailable.'
    },
    {
        response: { statusCode: 200, headers: 'invalid' },
        message: 'Undici diagnostics response headers are unavailable.'
    },
    {
        response: { statusCode: 200, headers: [ Buffer.from('one') ] },
        message: 'Undici diagnostics response headers are unavailable.'
    },
    {
        response: { statusCode: 200, headers: [ 'name', 'value' ] },
        message: 'Undici diagnostics response headers are unavailable.'
    }
];

export const testNode = suite('local HTTP transcript observations', [
    test('records server events without requiring an open network connection', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.start();
        fixture.incoming.emit('data', Buffer.from('request'));
        fixture.finish();
        scope.assert.deepEqual(fixture.observer.transcript.entries, [ [ 'http', {
            context: null,
            sequence: 0,
            request: {
                method: 'POST',
                url: 'https://service.test:42/value',
                headers: [ [ 'x-request', 'one' ], [ 'x-request', 'two' ] ],
                body: { kind: 'complete', bytes: encoder.encode('request') }
            },
            outcome: {
                kind: 'response',
                response: {
                    status: 200,
                    statusText: 'OK',
                    headers: [ [ 'x-reply', 'one' ], [ 'x-reply', 'two' ], [ 'x-count', '3' ] ],
                    body: { kind: 'unavailable', reason: 'transport-does-not-expose-body' }
                }
            }
        } ] ]);
        return scope.assert.collect();
    }),
    test('joins server requests with Undici response bodies and headers', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        startUndici(fixture);
        completeUndici(
            fixture,
            { statusCode: 201, headers: [ Buffer.from('X-Reply'), Buffer.from('yes') ] },
            Buffer.from('response')
        );
        scope.assert.deepEqual(observedInteraction(fixture).outcome, {
            kind: 'response',
            response: {
                status: 201,
                statusText: 'Created',
                headers: [ [ 'x-reply', 'yes' ] ],
                body: { kind: 'complete', bytes: encoder.encode('response') }
            }
        });
        scope.assert.equal(fixture.observer.transcript.entryCount, 1);
        return scope.assert.collect();
    }),
    test('uses safe defaults for absent server request metadata', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.incoming.method = undefined;
        fixture.incoming.url = undefined;
        fixture.start();
        fixture.finish();
        scope.assert.deepEqual(observedInteraction(fixture).request, {
            method: 'GET',
            url: 'https://service.test:42/',
            headers: [ [ 'x-request', 'one' ], [ 'x-request', 'two' ] ],
            body: { kind: 'absent' }
        });
        return scope.assert.collect();
    }),
    test('records an unfinished request when its observer is disposed', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.start();
        fixture.incoming.emit('data', Buffer.from('partial'));
        fixture.observer.dispose();
        fixture.observer.dispose();
        scope.assert.deepEqual(observedInteraction(fixture).outcome, {
            kind: 'incomplete',
            reason: 'resource-disposed'
        });
        fixture.finish();
        scope.assert.equal(fixture.observer.transcript.entryCount, 1);
        return scope.assert.collect();
    }),
    test('bounds request and response bodies independently', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        const bytes = new Uint8Array(httpTranscriptBodyByteLimit + 7);
        bytes.fill(65);
        startUndici(fixture);
        fixture.incoming.emit('data', bytes);
        completeUndici(fixture, { statusCode: 200, headers: [] }, bytes);
        const interaction = observedInteraction(fixture);
        scope.assert.deepEqual(interaction.request.body, {
            kind: 'truncated',
            bytes: bytes.slice(0, httpTranscriptBodyByteLimit),
            originalByteLength: bytes.length
        });
        scope.assert.partialDeepEqual(interaction.outcome, {
            kind: 'response',
            response: {
                body: {
                    kind: 'truncated',
                    bytes: bytes.slice(0, httpTranscriptBodyByteLimit),
                    originalByteLength: bytes.length
                }
            }
        });
        return scope.assert.collect();
    }),
    ...[
        { response: { statusCode: 599, headers: [] }, expected: '' },
        { response: { statusCode: 200, statusText: 'Custom', headers: [] }, expected: 'Custom' }
    ]
        .map(function responseStatus(expected) {
            return test(`preserves status text ${JSON.stringify(expected.expected)}`, function (scope: TestScope) {
                const fixture = httpObservationFixture(scope);
                startUndici(fixture);
                completeUndici(fixture, expected.response, new Uint8Array());
                scope.assert.partialDeepEqual(observedInteraction(fixture).outcome, {
                    kind: 'response',
                    response: { statusText: expected.expected, body: { kind: 'absent' } }
                });
                return scope.assert.collect();
            });
        }),
    ...invalidResponses.map(function invalidResponse(expected) {
        return test(`reports invalid response ${JSON.stringify(expected.response)}`, function (scope: TestScope) {
            const fixture = httpObservationFixture(scope);
            startUndici(fixture);
            completeUndici(fixture, expected.response, new Uint8Array());
            scope.assert.deepEqual(captureMessages(fixture), [ expected.message ]);
            return scope.assert.collect();
        });
    }),
    test('reports an Undici completion without a corresponding server request', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.publish('undici:request:create', { request: fixture.request });
        completeUndici(fixture, { statusCode: 200, headers: [] }, new Uint8Array());
        scope.assert.deepEqual(captureMessages(fixture), [
            'Undici diagnostics response lifecycle is missing server data.'
        ]);
        return scope.assert.collect();
    }),
    test('reports an Undici completion without client response headers', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        startUndici(fixture);
        fixture.publish('undici:request:trailers', { request: fixture.request });
        scope.assert.deepEqual(captureMessages(fixture), [
            'Undici diagnostics response lifecycle is missing client data.'
        ]);
        return scope.assert.collect();
    }),
    test('records transport failures and forgets the completed exchange', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        startUndici(fixture);
        fixture.publish('undici:request:error', { request: fixture.request, error: new Error('connection lost') });
        scope.assert.deepEqual(observedInteraction(fixture).outcome, {
            kind: 'error',
            error: { name: 'Error', message: 'connection lost' }
        });
        completeUndici(fixture, { statusCode: 200, headers: [] }, new Uint8Array());
        scope.assert.equal(fixture.observer.transcript.entryCount, 1);
        return scope.assert.collect();
    }),
    test('ignores an error before its server request is observed', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.publish('undici:request:create', { request: fixture.request });
        fixture.publish('undici:request:error', { request: fixture.request, error: new Error('not connected') });
        scope.assert.deepEqual(fixture.observer.transcript.entries, []);
        return scope.assert.collect();
    }),
    ...[ null, 1, {}, { request: {} }, { request: { origin: 1, path: '/value' } }, {
        request: { origin: 'https://other.test', path: '/value', method: 'GET' }
    } ]
        .map(function invalidMessage(message) {
            return test(`ignores unrelated diagnostics ${JSON.stringify(message)}`, function (scope: TestScope) {
                const fixture = httpObservationFixture(scope);
                for (
                    const channel of [
                        'undici:request:create',
                        'http.server.request.start',
                        'http.server.response.finish',
                        'undici:request:headers',
                        'undici:request:bodyChunkReceived',
                        'undici:request:trailers',
                        'undici:request:error'
                    ]
                ) {
                    fixture.publish(channel, message);
                }
                scope.assert.deepEqual(fixture.observer.transcript.entries, []);
                return scope.assert.collect();
            });
        }),
    test('reports missing Undici methods as capture errors', function (scope: TestScope) {
        const fixture = httpObservationFixture(scope);
        fixture.publish('undici:request:create', { request: { origin: 'https://service.test:42', path: '/value' } });
        scope.assert.deepEqual(captureMessages(fixture), [ 'Undici diagnostics request method is unavailable.' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
