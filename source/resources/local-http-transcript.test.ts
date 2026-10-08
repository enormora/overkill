import diagnosticsChannel from 'node:diagnostics_channel';
import { createServer, request as createRequest, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    httpTranscriptBodyByteLimit,
    type HttpTranscript,
    type HttpTranscriptEntry
} from '../transcript/http-transcript.ts';
import {
    createLocalHttpServiceResource,
    type LocalHttpResourceHandle,
    type LocalHttpServiceHandle,
    type LocalHttpTranscriptPolicy
} from './local-http-service-resource.ts';
import { startResources, type ResourceSession } from './resource-session.ts';
import type { EmptyResourceDependencies, ResourceDefinition } from './resources.ts';
import { observeLocalHttpServer } from './local-http-transcript-observer.ts';

type LocalHttpTestResource = ResourceDefinition<
    'app',
    LocalHttpResourceHandle<LocalHttpServiceHandle>,
    EmptyResourceDependencies
>;
type DisabledTranscriptPolicy = { readonly kind: 'disabled'; };
type TestTranscriptPolicy = LocalHttpTranscriptPolicy<null>;
type DiagnosticErrorAction = { readonly error: unknown; readonly kind: 'error'; };
type DiagnosticCompletionAction = { readonly kind: 'completion'; };
type DiagnosticResponseAction = {
    readonly kind: 'response';
    readonly response: Readonly<Record<string, unknown>>;
};
type DiagnosticAction = DiagnosticCompletionAction | DiagnosticErrorAction | DiagnosticResponseAction;
type DiagnosticActionState = {
    readonly action: DiagnosticAction;
    readonly request: Readonly<Record<string, unknown>>;
};
type LocalHttpTestSession = ResourceSession<{ readonly app: LocalHttpTestResource; }>;

const testController = new AbortController();
const testSignal = testController.signal;
const textEncoder = new TextEncoder();

function localHttpResourceWithResponseHook(
    responseHook: (response: ServerResponse) => void,
    ...policy: readonly [] | readonly [TestTranscriptPolicy]
): LocalHttpTestResource {
    const input = {
        name: 'app',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        createServer() {
            return createServer(function respond(_request, response) {
                response.setHeader('set-cookie', [ 'one=1', 'two=2' ]);
                response.setHeader('x-count', 2);
                responseHook(response);
                response.end('ready');
            });
        },
        handle(handle: LocalHttpServiceHandle) {
            return handle;
        },
        dispose() {
            return undefined;
        }
    } as const;

    return policy.length === 0
        ? createLocalHttpServiceResource(input)
        : createLocalHttpServiceResource(input, policy[0]);
}

function localHttpResource(...policy: readonly [] | readonly [TestTranscriptPolicy]): LocalHttpTestResource {
    return localHttpResourceWithResponseHook(function doNothing() {
        return undefined;
    }, ...policy);
}

async function requestWithNodeHttp(url: string, body: string): Promise<void> {
    await new Promise<void>(function sendRequest(resolve, reject) {
        const request = createRequest(url, { method: 'POST' }, function receiveResponse(response) {
            response.resume();
            response.on('end', resolve);
        });

        request.on('error', reject);
        request.end(body);
    });
}

async function requestWithRawTcp(endpoint: LocalHttpServiceHandle['endpoint']): Promise<void> {
    await new Promise<void>(function sendRequest(resolve, reject) {
        const socket = connect(endpoint.port, endpoint.host);

        socket.on('connect', function writeRequest() {
            socket.end([
                'GET /raw HTTP/1.1',
                `Host: ${endpoint.host}:${endpoint.port}`,
                'Set-Cookie: one=1',
                'Set-Cookie: two=2',
                'Connection: close',
                '',
                ''
            ]
                .join('\r\n'));
        });
        socket.on('data', function consumeResponse() {
            return undefined;
        });
        socket.on('error', reject);
        socket.on('close', resolve);
    });
}

function assertBoundedExternalEntry(scope: TestScope, entry: HttpTranscriptEntry<unknown>, body: string): void {
    scope.assert.deepEqual(entry[1].request.body, {
        bytes: textEncoder.encode(body.slice(0, httpTranscriptBodyByteLimit)),
        kind: 'truncated',
        originalByteLength: body.length
    });
    scope.assert.equal(entry[1].outcome.kind, 'response');
    if (entry[1].outcome.kind === 'response') {
        scope.assert.deepEqual(entry[1].outcome.response.body, {
            kind: 'unavailable',
            reason: 'transport-does-not-expose-body'
        });
    }
}

async function assertExternalRequest(scope: TestScope): Promise<void> {
    const session = await startResources({ resources: { app: localHttpResource() }, signal: testSignal });
    const body = 'x'.repeat(httpTranscriptBodyByteLimit + 1);

    await requestWithNodeHttp(session.context.app.baseUrl, body);
    const entry = session.context.app.transcript.firstEntry;

    scope.require.defined(entry);
    scope.assert.equal(entry[0], 'http');
    if (entry[0] === 'http') {
        assertBoundedExternalEntry(scope, entry, body);
    }

    await session.disposeOnce({ signal: testSignal });
}

async function assertRawRequest(scope: TestScope): Promise<void> {
    const session = await startResources({ resources: { app: localHttpResource() }, signal: testSignal });

    await requestWithRawTcp(session.context.app.endpoint);
    const entry = session.context.app.transcript.firstEntry;

    scope.require.defined(entry);
    scope.assert.equal(entry[0], 'http');
    if (entry[0] === 'http') {
        scope.assert.equal(entry[1].request.url, `${session.context.app.baseUrl}/raw`);
        scope.assert.deepEqual(
            entry[1].request.headers.filter(function isSetCookie([ name ]) {
                return name === 'set-cookie';
            }),
            [ [ 'set-cookie', 'one=1' ], [ 'set-cookie', 'two=2' ] ]
        );
    }

    await session.disposeOnce({ signal: testSignal });
}

async function transcriptEntryCount(policy: DisabledTranscriptPolicy): Promise<number> {
    const session = await startResources({ resources: { app: localHttpResource(policy) }, signal: testSignal });

    await fetch(session.context.app.baseUrl);
    const { entryCount } = session.context.app.transcript;

    await session.disposeOnce({ signal: testSignal });

    return entryCount;
}

async function captureFailureEntries(): Promise<HttpTranscript<unknown>['entries']> {
    const session = await startResources({
        resources: {
            app: localHttpResource({
                kind: 'custom',
                transcript() {
                    throw new Error('capture failed');
                }
            })
        },
        signal: testSignal
    });

    await fetch(session.context.app.baseUrl);
    const { entries } = session.context.app.transcript;

    await session.disposeOnce({ signal: testSignal });

    return entries;
}

async function assertTranscriptPolicies(scope: TestScope): Promise<void> {
    scope.assert.equal(await transcriptEntryCount({ kind: 'disabled' }), 0);
    scope.assert.deepEqual(await captureFailureEntries(), [
        [ 'capture-error', { message: 'capture failed', source: 'custom' } ]
    ]);
}

function publishDiagnostic(name: string, message: unknown): void {
    diagnosticsChannel.channel(name).publish(message);
}

function publishIncompleteUndiciDiagnostics(
    incompleteRequest: Readonly<Record<string, unknown>>,
    failedRequest: Readonly<Record<string, unknown>>
): void {
    publishDiagnostic('undici:request:create', { request: incompleteRequest });
    publishDiagnostic('undici:request:bodyChunkReceived', { chunk: 'invalid', request: incompleteRequest });
    publishDiagnostic('undici:request:headers', { request: incompleteRequest, response: null });
    publishDiagnostic('undici:request:trailers', { request: incompleteRequest });
    publishDiagnostic('undici:request:create', { request: failedRequest });
    publishDiagnostic('undici:request:error', { error: 'connection failed', request: failedRequest });
}

function publishMalformedUndiciDiagnostics(baseUrl: string): void {
    const methodlessRequest = { origin: baseUrl, path: '/' };
    const incompleteRequest = { method: 'GET', origin: baseUrl, path: '/' };
    const failedRequest = { method: 'GET', origin: baseUrl, path: '/failed' };

    publishDiagnostic('undici:request:create', null);
    publishDiagnostic('undici:request:create', { request: { method: 'GET', origin: 42, path: '/' } });
    publishDiagnostic('undici:request:create', {
        request: { method: 'GET', origin: 'http://127.0.0.1:54321', path: '/' }
    });
    publishDiagnostic('undici:request:create', { request: methodlessRequest });
    publishIncompleteUndiciDiagnostics(incompleteRequest, failedRequest);
}

function publishMalformedNodeHttpDiagnostics(): void {
    publishDiagnostic('http.client.request.start', null);
    publishDiagnostic('http.client.request.start', { request: {} });
    publishDiagnostic('http.client.request.start', {
        request: {
            getHeader() {
                return undefined;
            },
            method: 'GET',
            path: '/',
            protocol: 'http:'
        }
    });
    publishDiagnostic('http.client.request.start', {
        request: {
            getHeader() {
                return '127.0.0.1:54321';
            },
            method: 'GET',
            path: '/',
            protocol: 'http:'
        }
    });
    publishDiagnostic('http.server.request.start', null);
    publishDiagnostic('http.server.request.start', { request: {}, response: {}, server: {} });
    publishDiagnostic('http.server.response.finish', null);
    publishDiagnostic('undici:request:bodyChunkReceived', null);
    publishDiagnostic('undici:request:headers', null);
    publishDiagnostic('undici:request:error', null);
}

function assertDiagnosticFailuresAreContained(scope: TestScope): void {
    const baseUrl = 'http://127.0.0.1:12345';
    const observer = observeLocalHttpServer({}, baseUrl, 'attempt');

    publishMalformedUndiciDiagnostics(baseUrl);
    publishMalformedNodeHttpDiagnostics();

    observer.dispose();

    scope.assert.deepEqual(observer.transcript.entries, [
        [ 'capture-error', {
            message: 'Undici diagnostics request method is unavailable.',
            source: 'undici'
        } ],
        [ 'capture-error', {
            message: 'Undici diagnostics response lifecycle is missing server data.',
            source: 'undici'
        } ]
    ]);
}

async function performDiagnosticAction(
    session: LocalHttpTestSession,
    selectAction: (state: DiagnosticActionState) => void,
    action: DiagnosticAction
): Promise<void> {
    const request = { method: 'GET', origin: session.context.app.baseUrl, path: '/raw' };

    selectAction({ action, request });
    publishDiagnostic('undici:request:create', { request });
    await requestWithRawTcp(session.context.app.endpoint);
}

async function performMalformedResponseDiagnostics(
    session: LocalHttpTestSession,
    selectAction: (state: DiagnosticActionState) => void
): Promise<void> {
    const invalidHeaderName = { headers: [ 'name', textEncoder.encode('value') ], statusCode: 200 };

    await performDiagnosticAction(session, selectAction, {
        kind: 'response',
        response: { headers: [ textEncoder.encode('name') ], statusCode: 200 }
    });
    await performDiagnosticAction(session, selectAction, { kind: 'response', response: invalidHeaderName });
    await performDiagnosticAction(session, selectAction, {
        kind: 'response',
        response: { headers: [], statusCode: 'invalid' }
    });
    await performDiagnosticAction(session, selectAction, {
        kind: 'response',
        response: { headers: [], statusCode: 999 }
    });
    await performDiagnosticAction(session, selectAction, { kind: 'completion' });
    await performDiagnosticAction(session, selectAction, { error: 'connection failed', kind: 'error' });
}

function assertMalformedResponseEntries(scope: TestScope, session: LocalHttpTestSession): void {
    scope.assert.equal(
        session
            .context
            .app
            .transcript
            .entries
            .filter(function isCaptureError([ kind ]) {
                return kind === 'capture-error';
            })
            .length,
        4
    );
    scope.assert.equal(
        session.context.app.transcript.entries.some(function hasUnknownStatus(entry) {
            return entry[0] === 'http' && entry[1].outcome.kind === 'response' &&
                entry[1].outcome.response.statusText === '';
        }),
        true
    );
    scope.assert.equal(
        session.context.app.transcript.entries.some(function hasClientError(entry) {
            return entry[0] === 'http' && entry[1].outcome.kind === 'error' &&
                entry[1].outcome.error.message === 'connection failed';
        }),
        true
    );
}

async function assertMalformedResponseDiagnostics(scope: TestScope): Promise<void> {
    let actionState: DiagnosticActionState = {
        action: { error: 'connection failed', kind: 'error' },
        request: {}
    };
    const resource = localHttpResourceWithResponseHook(function publishResponseDiagnostics() {
        if (actionState.action.kind === 'error') {
            publishDiagnostic('undici:request:error', {
                error: actionState.action.error,
                request: actionState.request
            });
        } else if (actionState.action.kind === 'response') {
            publishDiagnostic('undici:request:headers', {
                request: actionState.request,
                response: actionState.action.response
            });
            publishDiagnostic('undici:request:trailers', { request: actionState.request });
        } else {
            publishDiagnostic('undici:request:trailers', { request: actionState.request });
        }
    });
    const session = await startResources({ resources: { app: resource }, signal: testSignal });

    await performMalformedResponseDiagnostics(session, function selectAction(state) {
        actionState = state;
    });
    assertMalformedResponseEntries(scope, session);

    await session.disposeOnce({ signal: testSignal });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/local-http-transcript.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP resources record external request metadata and bounded bodies',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertExternalRequest(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP resources record requests outside instrumented clients',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertRawRequest(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP resources support transcript policies',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertTranscriptPolicies(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP transcript diagnostics contain malformed lifecycle events',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertDiagnosticFailuresAreContained(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP transcripts contain malformed response diagnostics',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertMalformedResponseDiagnostics(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
