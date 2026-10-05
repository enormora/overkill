import diagnosticsChannel from 'node:diagnostics_channel';
import { IncomingMessage, STATUS_CODES, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import {
    createHttpTranscriptRecorder,
    httpTranscriptBodyByteLimit,
    recordedHttpBody,
    recordedHttpError,
    type HttpHeadersSnapshot,
    type HttpInteraction,
    type HttpRequestSnapshot,
    type HttpResponseSnapshot,
    type HttpTranscript,
    type HttpTranscriptRecorder,
    type RecordedHttpBody,
    type TranscriptScope
} from '../packages/simulation/http.entry-point.ts';

type UndiciRequest = Readonly<Record<string, unknown>>;
type UndiciResponse = Readonly<Record<string, unknown>>;
type BodyCapture = {
    readonly append: (chunk: Uint8Array) => void;
    readonly body: () => RecordedHttpBody;
};
type RequestObservation = {
    readonly body: BodyCapture;
    readonly request: HttpRequestSnapshot;
    readonly sequence: number;
    readonly scope: TranscriptScope | null;
};
type UndiciObservation = {
    readonly responseBody: BodyCapture;
    readonly serverRequest: IncomingMessage | null;
};
type ExpectedRequest = {
    readonly scope: TranscriptScope | null;
    readonly undiciRequest: UndiciRequest | null;
};
type UndiciDiagnostic = {
    readonly observation: UndiciObservation;
    readonly request: UndiciRequest;
};
type UndiciCompletion = {
    readonly response: UndiciResponse;
    readonly serverObservation: RequestObservation;
};
type ObservedServerResponse = {
    readonly getHeaders: () => OutgoingHttpHeaders;
    readonly statusCode: number;
    readonly statusMessage: string | undefined;
};
type ServerDiagnostic = {
    readonly request: IncomingMessage;
    readonly response: ObservedServerResponse;
};
type ObservedNodeClientRequest = {
    readonly getHeader: (name: string) => number | string | readonly string[] | undefined;
    readonly method: string;
    readonly path: string;
    readonly protocol: string;
};
type ValueSet<Value> = Pick<Set<Value>, 'add' | 'delete' | 'values'>;
type ValueMap<Key, Value> = Pick<Map<Key, Value>, 'entries' | 'get' | 'set'>;
type ObserverState = {
    readonly activeRequests: ValueSet<IncomingMessage>;
    readonly baseUrl: string;
    readonly expectedByRequest: ValueMap<string, readonly ExpectedRequest[]>;
    readonly listeners: ValueMap<string, (message: unknown) => void>;
    readonly recorder: HttpTranscriptRecorder<null>;
    readonly requests: WeakMap<IncomingMessage, RequestObservation>;
    readonly server: unknown;
    readonly undici: WeakMap<UndiciRequest, UndiciObservation>;
    readonly undiciRequests: ValueSet<UndiciRequest>;
    readonly undiciResponses: WeakMap<UndiciRequest, UndiciResponse>;
};

export type LocalHttpTranscriptObserver = {
    readonly dispose: () => void;
    readonly transcript: HttpTranscript;
};

const headerPairLength = 2;
const channels = Object.freeze({
    serverFinish: 'http.server.response.finish',
    serverStart: 'http.server.request.start',
    nodeClientStart: 'http.client.request.start',
    undiciBodyReceived: 'undici:request:bodyChunkReceived',
    undiciCreate: 'undici:request:create',
    undiciError: 'undici:request:error',
    undiciHeaders: 'undici:request:headers',
    undiciTrailers: 'undici:request:trailers'
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function createBodyCapture(): BodyCapture {
    let byteLength = 0;
    const chunks: Uint8Array[] = [];

    return Object.freeze({
        append(chunk: Uint8Array) {
            const remaining = Math.max(0, httpTranscriptBodyByteLimit - byteLength);

            byteLength += chunk.byteLength;
            if (remaining > 0) {
                chunks.push(Uint8Array.from(chunk.subarray(0, remaining)));
            }
        },
        body(): RecordedHttpBody {
            const bytes = chunks.length === 0 ? null : Buffer.concat(chunks);

            return byteLength > httpTranscriptBodyByteLimit && bytes !== null
                ? { bytes: Uint8Array.from(bytes), kind: 'truncated', originalByteLength: byteLength }
                : recordedHttpBody(bytes);
        }
    });
}

function incomingHeaders(headers: IncomingHttpHeaders): HttpHeadersSnapshot {
    const entries: (readonly [string, string])[] = [];

    for (const [ name, value ] of Object.entries(headers)) {
        const values = Array.isArray(value) ? value : [ value ];

        for (const item of values) {
            if (item !== undefined) {
                entries.push(Object.freeze([ name.toLowerCase(), item ]));
            }
        }
    }

    return Object.freeze(entries);
}

function outgoingHeaders(headers: OutgoingHttpHeaders): HttpHeadersSnapshot {
    const entries: (readonly [string, string])[] = [];

    for (const [ name, value ] of Object.entries(headers)) {
        const values = Array.isArray(value) ? value : [ value ];

        for (const item of values) {
            if (item !== undefined) {
                entries.push(Object.freeze([ name.toLowerCase(), String(item) ]));
            }
        }
    }

    return Object.freeze(entries);
}

function requestUrl(request: IncomingMessage, baseUrl: string): string {
    const url = new URL(request.url ?? '/', baseUrl);

    return url.href;
}

function isObservedServerResponse(value: unknown): value is ObservedServerResponse {
    return isRecord(value) && typeof value.getHeaders === 'function' &&
        typeof value.statusCode === 'number' &&
        (value.statusMessage === undefined || typeof value.statusMessage === 'string');
}

function serverMessage(message: unknown, server: unknown): ServerDiagnostic | null {
    if (
        !isRecord(message) || message.server !== server || !(message.request instanceof IncomingMessage) ||
        !isObservedServerResponse(message.response)
    ) {
        return null;
    }

    return { request: message.request, response: message.response };
}

function undiciMessage(message: unknown): { readonly request: UndiciRequest; } | null {
    return isRecord(message) && isRecord(message.request) ? { request: message.request } : null;
}

function undiciUrl(request: UndiciRequest): string | null {
    if (typeof request.origin !== 'string' || typeof request.path !== 'string') {
        return null;
    }

    const url = new URL(request.path, request.origin);

    return url.href;
}

function isObservedNodeClientRequest(value: unknown): value is ObservedNodeClientRequest {
    return isRecord(value) && typeof value.getHeader === 'function' && typeof value.method === 'string' &&
        typeof value.path === 'string' && typeof value.protocol === 'string';
}

function nodeClientUrl(request: ObservedNodeClientRequest): string | null {
    const host = request.getHeader('host');

    if (
        typeof host !== 'string'
    ) {
        return null;
    }

    const url = new URL(request.path, `${request.protocol}//${host}`);

    return url.href;
}

function requestIdentity(method: string, url: string): string {
    return `${method.toUpperCase()} ${url}`;
}

function undiciRequestIdentity(request: UndiciRequest, url: string): string {
    if (typeof request.method !== 'string') {
        throw new TypeError('Undici diagnostics request method is unavailable.');
    }

    return requestIdentity(request.method, url);
}

function responseHeader(name: unknown, value: unknown): readonly [string, string] {
    if (!(name instanceof Uint8Array) || !(value instanceof Uint8Array)) {
        throw new TypeError('Undici diagnostics response headers are unavailable.');
    }

    return Object.freeze([
        Buffer.from(name).toString().toLowerCase(),
        Buffer.from(value).toString()
    ]);
}

function responseHeaders(value: unknown): HttpHeadersSnapshot {
    if (!Array.isArray(value) || value.length % headerPairLength !== 0) {
        throw new TypeError('Undici diagnostics response headers are unavailable.');
    }

    const headerValues: readonly unknown[] = value;
    const entries: (readonly [string, string])[] = [];

    for (let index = 0; index < headerValues.length; index += headerPairLength) {
        entries.push(responseHeader(headerValues[index], headerValues[index + 1]));
    }

    return Object.freeze(entries);
}

function responseStatusText(status: number, statusText: string | undefined): string {
    return statusText ?? STATUS_CODES[status] ?? '';
}

function responseSnapshot(response: UndiciResponse, body: RecordedHttpBody): HttpResponseSnapshot {
    if (
        typeof response.statusCode !== 'number' ||
        response.statusText !== undefined && typeof response.statusText !== 'string'
    ) {
        throw new TypeError('Undici diagnostics response metadata is unavailable.');
    }

    return {
        body,
        headers: responseHeaders(response.headers),
        status: response.statusCode,
        statusText: responseStatusText(response.statusCode, response.statusText)
    };
}

function createObserverState(server: unknown, baseUrl: string): ObserverState {
    return {
        activeRequests: new Set(),
        baseUrl,
        expectedByRequest: new Map(),
        listeners: new Map(),
        recorder: createHttpTranscriptRecorder(),
        requests: new WeakMap(),
        server,
        undici: new WeakMap(),
        undiciRequests: new Set(),
        undiciResponses: new WeakMap()
    };
}

function observesUrl(state: ObserverState, url: string | null): url is string {
    return url !== null && (url === state.baseUrl || url.startsWith(`${state.baseUrl}/`));
}

function observeUndiciCreate(state: ObserverState, message: unknown): void {
    const diagnostic = undiciMessage(message);
    const url = diagnostic === null ? null : undiciUrl(diagnostic.request);

    if (diagnostic === null || !observesUrl(state, url)) {
        return;
    }

    state.undici.set(diagnostic.request, {
        responseBody: createBodyCapture(),
        serverRequest: null
    });
    state.undiciRequests.add(diagnostic.request);
    const identity = undiciRequestIdentity(diagnostic.request, url);

    state.expectedByRequest.set(identity, [
        ...state.expectedByRequest.get(identity) ?? [],
        { scope: state.recorder.currentScope(), undiciRequest: diagnostic.request }
    ]);
}

function observeNodeClientStart(state: ObserverState, message: unknown): void {
    if (!isRecord(message) || !isObservedNodeClientRequest(message.request)) {
        return;
    }

    const url = nodeClientUrl(message.request);

    if (!observesUrl(state, url)) {
        return;
    }

    const identity = requestIdentity(message.request.method, url);

    state.expectedByRequest.set(identity, [
        ...state.expectedByRequest.get(identity) ?? [],
        { scope: state.recorder.currentScope(), undiciRequest: null }
    ]);
}

function takeExpectedRequest(state: ObserverState, identity: string): ExpectedRequest | null {
    const expected = state.expectedByRequest.get(identity) ?? [];
    const request = expected[0] ?? null;

    state.expectedByRequest.set(identity, expected.slice(1));

    return request;
}

function pairUndiciRequest(
    state: ObserverState,
    url: string,
    serverRequest: IncomingMessage
): TranscriptScope | null {
    const expected = takeExpectedRequest(state, requestIdentity(serverRequest.method ?? 'GET', url));

    if (expected === null) {
        return state.recorder.currentScope();
    }

    if (expected.undiciRequest === null) {
        return expected.scope;
    }

    const observation = state.undici.get(expected.undiciRequest);

    if (observation === undefined) {
        return state.recorder.currentScope();
    }

    state.undici.set(expected.undiciRequest, { ...observation, serverRequest });

    return expected.scope;
}

function observeServerStart(state: ObserverState, message: unknown): void {
    const diagnostic = serverMessage(message, state.server);

    if (diagnostic === null) {
        return;
    }

    const url = requestUrl(diagnostic.request, state.baseUrl);
    const body = createBodyCapture();

    const scope = pairUndiciRequest(state, url, diagnostic.request);
    state.requests.set(diagnostic.request, {
        body,
        request: {
            body: { kind: 'unavailable', reason: 'body-not-observed' },
            headers: incomingHeaders(diagnostic.request.headers),
            method: diagnostic.request.method ?? 'GET',
            url
        },
        sequence: state.recorder.nextSequence(),
        scope
    });
    state.activeRequests.add(diagnostic.request);
    diagnostic.request.on('data', body.append);
}

function hasUndiciPair(state: ObserverState, request: IncomingMessage): boolean {
    return Array.from(state.undiciRequests.values()).some(function matches(undiciRequest) {
        return state.undici.get(undiciRequest)?.serverRequest === request;
    });
}

function observeServerFinish(state: ObserverState, message: unknown): void {
    const diagnostic = serverMessage(message, state.server);
    const observation = diagnostic === null ? undefined : state.requests.get(diagnostic.request);

    if (diagnostic === null || observation === undefined) {
        return;
    }

    if (!hasUndiciPair(state, diagnostic.request)) {
        state.activeRequests.delete(diagnostic.request);
        state.recorder.record({
            context: null,
            outcome: {
                kind: 'response',
                response: {
                    body: { kind: 'unavailable', reason: 'transport-does-not-expose-body' },
                    headers: outgoingHeaders(diagnostic.response.getHeaders()),
                    status: diagnostic.response.statusCode,
                    statusText: responseStatusText(
                        diagnostic.response.statusCode,
                        diagnostic.response.statusMessage
                    )
                }
            },
            request: { ...observation.request, body: observation.body.body() },
            sequence: observation.sequence
        }, observation.scope);
    }
}

function undiciObservation(state: ObserverState, message: unknown): UndiciDiagnostic | null {
    const diagnostic = undiciMessage(message);
    const observation = diagnostic === null ? undefined : state.undici.get(diagnostic.request);

    return diagnostic === null || observation === undefined ? null : { observation, request: diagnostic.request };
}

function observeUndiciBody(state: ObserverState, message: unknown): void {
    const diagnostic = undiciObservation(state, message);

    if (diagnostic !== null && isRecord(message) && message.chunk instanceof Uint8Array) {
        diagnostic.observation.responseBody.append(message.chunk);
    }
}

function forgetUndiciRequest(state: ObserverState, request: UndiciRequest): void {
    const serverRequest = state.undici.get(request)?.serverRequest;

    if (serverRequest !== null && serverRequest !== undefined) {
        state.activeRequests.delete(serverRequest);
    }
    state.undici.delete(request);
    state.undiciRequests.delete(request);
    state.undiciResponses.delete(request);
}

function pairedServerObservation(
    state: ObserverState,
    diagnostic: ReturnType<typeof undiciObservation>
): RequestObservation | undefined {
    const serverRequest = diagnostic?.observation.serverRequest;

    return serverRequest === null || serverRequest === undefined ? undefined : state.requests.get(serverRequest);
}

function undiciCompletion(
    state: ObserverState,
    diagnostic: NonNullable<ReturnType<typeof undiciObservation>>
): UndiciCompletion {
    const serverObservation = pairedServerObservation(state, diagnostic);
    const response = state.undiciResponses.get(diagnostic.request);

    if (serverObservation === undefined || response === undefined) {
        forgetUndiciRequest(state, diagnostic.request);
        throw new TypeError(
            `Undici diagnostics response lifecycle is missing ${
                serverObservation === undefined ? 'server' : 'client'
            } data.`
        );
    }

    return { response, serverObservation };
}

function observeUndiciCompletion(state: ObserverState, message: unknown): void {
    const diagnostic = undiciObservation(state, message);

    if (diagnostic === null) {
        return;
    }

    const { response, serverObservation } = undiciCompletion(state, diagnostic);

    try {
        state.recorder.record({
            context: null,
            outcome: {
                kind: 'response',
                response: responseSnapshot(response, diagnostic.observation.responseBody.body())
            },
            request: { ...serverObservation.request, body: serverObservation.body.body() },
            sequence: serverObservation.sequence
        }, serverObservation.scope);
    } finally {
        forgetUndiciRequest(state, diagnostic.request);
    }
}

function observeUndiciHeaders(state: ObserverState, message: unknown): void {
    const diagnostic = undiciObservation(state, message);

    if (diagnostic !== null && isRecord(message) && isRecord(message.response)) {
        state.undiciResponses.set(diagnostic.request, message.response);
    }
}

function observeUndiciError(state: ObserverState, message: unknown): void {
    const diagnostic = undiciObservation(state, message);
    const serverObservation = pairedServerObservation(state, diagnostic);

    if (diagnostic === null || !isRecord(message)) {
        return;
    }

    if (serverObservation !== undefined) {
        state.recorder.record({
            context: null,
            outcome: { error: recordedHttpError(message.error), kind: 'error' },
            request: { ...serverObservation.request, body: serverObservation.body.body() },
            sequence: serverObservation.sequence
        }, serverObservation.scope);
    }

    forgetUndiciRequest(state, diagnostic.request);
}

function guardedObserver(
    state: ObserverState,
    source: 'node-http' | 'undici',
    observer: (message: unknown) => void
): (message: unknown) => void {
    return function observeSafely(message) {
        try {
            observer(message);
        } catch (error: unknown) {
            state.recorder.recordCaptureError(source, error, state.recorder.currentScope());
        }
    };
}

function subscribeObservers(state: ObserverState): void {
    const registrations: readonly (readonly [string, 'node-http' | 'undici', (message: unknown) => void])[] = [
        [ channels.undiciCreate, 'undici', observeUndiciCreate.bind(undefined, state) ],
        [ channels.nodeClientStart, 'node-http', observeNodeClientStart.bind(undefined, state) ],
        [ channels.serverStart, 'node-http', observeServerStart.bind(undefined, state) ],
        [ channels.serverFinish, 'node-http', observeServerFinish.bind(undefined, state) ],
        [ channels.undiciBodyReceived, 'undici', observeUndiciBody.bind(undefined, state) ],
        [ channels.undiciTrailers, 'undici', observeUndiciCompletion.bind(undefined, state) ],
        [ channels.undiciHeaders, 'undici', observeUndiciHeaders.bind(undefined, state) ],
        [ channels.undiciError, 'undici', observeUndiciError.bind(undefined, state) ]
    ];

    for (const [ name, source, observer ] of registrations) {
        const listener = guardedObserver(state, source, observer);

        state.listeners.set(name, listener);
        diagnosticsChannel.subscribe(name, listener);
    }
}

function disposeObservers(state: ObserverState): void {
    for (const [ name, listener ] of state.listeners.entries()) {
        diagnosticsChannel.unsubscribe(name, listener);
    }

    for (const request of state.activeRequests.values()) {
        const observation = state.requests.get(request);

        if (observation !== undefined) {
            const interaction: HttpInteraction<null> = {
                context: null,
                outcome: { kind: 'incomplete', reason: 'resource-disposed' },
                request: { ...observation.request, body: observation.body.body() },
                sequence: observation.sequence
            };

            state.recorder.record(interaction, observation.scope);
        }
    }
}

export function observeLocalHttpServer(server: unknown, baseUrl: string): LocalHttpTranscriptObserver {
    const state = createObserverState(server, baseUrl);

    subscribeObservers(state);

    return Object.freeze({
        dispose() {
            disposeObservers(state);
        },
        transcript: state.recorder.transcript
    });
}
