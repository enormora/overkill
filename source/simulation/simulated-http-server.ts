import http from 'node:http';
import { isIPv6 } from 'node:net';
import {
    createHttpTranscriptRecorder,
    httpHeadersSnapshot,
    recordedHttpBody,
    recordedHttpError,
    type HttpRequestSnapshot,
    type HttpTranscript,
    type HttpTranscriptRecorder
} from '../transcript/http-transcript.ts';
import {
    currentTranscriptScope,
    type TranscriptScope
} from '../transcript/transcript-store.ts';
import {
    assertRoutableScenarios,
    fixedScenario,
    requestRoutedScenario,
    simulatedHttpScenarioUrl,
    type ScenarioRoute,
    type ScenarioRouting
} from './simulated-http-routing.ts';
import {
    isDefinedSimulatedHttpServer,
    type SimulatedHttpServerDefinition,
    type SimulationScenarioCatalog
} from './simulation.ts';

const handlerFailureStatus = 500;

export type SimulatedHttpServerOptions<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = {
    readonly host?: string;
    readonly port?: number;
    readonly simulation: SimulatedHttpServerDefinition<Name, Scenarios>;
};

type SimulationWithScenarios = {
    readonly scenarios: SimulationScenarioCatalog;
};

type ListeningHandle<Scenario extends string | null> = {
    readonly baseUrl: string;
    readonly dispose: () => Promise<void>;
    readonly transcript: HttpTranscript<{ readonly scenario: Scenario; }>;
};

type ServerHandle<Scenario extends string | null> = AsyncDisposable & ListeningHandle<Scenario>;

export type SimulatedHttpServerHandle<Simulation extends SimulationWithScenarios> = ServerHandle<string | null> & {
    readonly scenarioUrl: (scenario: string & keyof Simulation['scenarios'], path: string) => string;
};

export type FixedSimulatedHttpServerHandle = ServerHandle<string>;

export type FixedSimulatedHttpServerOptions<
    Name extends string,
    Scenarios extends SimulationScenarioCatalog
> = SimulatedHttpServerOptions<Name, Scenarios> & {
    readonly scenario: NoInfer<string & keyof Scenarios>;
};

type ListenAddress = {
    readonly host: string;
    readonly port: number;
};
type ServerAddress = {
    readonly port: number;
};
type ServerAddressReader = {
    readonly address: () => ServerAddress | string | null;
};
type ServerLifecycle = {
    readonly address: () => ServerAddress | string | null;
    readonly close: (callback: (error?: Error) => void) => unknown;
    readonly listen: (port: number, host: string) => unknown;
    readonly listening: boolean;
    readonly off: {
        (event: 'error', listener: (error: Error) => void): unknown;
        (event: 'listening', listener: () => void): unknown;
    };
    readonly once: {
        (event: 'error', listener: (error: Error) => void): unknown;
        (event: 'listening', listener: () => void): unknown;
    };
};
type ResponseHead = {
    (status: number): unknown;
    (status: number, statusText: string, headers: Readonly<Record<string, string>>): unknown;
};
type ResponseWriter = {
    readonly end: (body: Uint8Array | string) => unknown;
    readonly writeHead: ResponseHead;
};
type SimulationRequest = {
    readonly method: string | undefined;
    readonly url: string | undefined;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly on: {
        (event: 'data', listener: (chunk: Uint8Array) => void): unknown;
        (event: 'error', listener: (error: unknown) => void): unknown;
        (event: 'end', listener: () => void): unknown;
    };
};
type SimulationRequestContext<Scenario extends string | null> = {
    readonly baseUrl: string;
    readonly recordError: (error: unknown) => void;
    readonly request: SimulationRequest;
    readonly response: ResponseWriter;
    readonly scope: TranscriptScope | null;
    readonly route: ScenarioRouting<Scenario>;
    readonly transcript: HttpTranscriptRecorder<{ readonly scenario: Scenario; }>;
};
type HandlerErrors = {
    readonly errors: readonly unknown[];
    readonly record: (error: unknown) => void;
};
type SimulationServerOptions<Scenario extends string | null> = {
    readonly host: string;
    readonly recordError: (error: unknown) => void;
    readonly scope: TranscriptScope | null;
    readonly route: ScenarioRouting<Scenario>;
    readonly transcript: HttpTranscriptRecorder<{ readonly scenario: Scenario; }>;
};
export type SimulatedHttpListeningServer<Scenario extends string | null = string | null> = {
    readonly errors: readonly unknown[];
    readonly server: ServerLifecycle;
    readonly transcript: HttpTranscript<{ readonly scenario: Scenario; }>;
};

async function collectRequestBody(request: SimulationRequest): Promise<Uint8Array<ArrayBuffer> | null> {
    const method = request.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') {
        return null;
    }

    return await new Promise(function collectBody(resolve, reject) {
        const chunks: Uint8Array[] = [];

        request.on('data', function recordChunk(chunk: Uint8Array) {
            chunks.push(chunk);
        });
        request.on('error', reject);
        request.on('end', function resolveBody() {
            resolve(Buffer.concat(chunks));
        });
    });
}

function requestHeaders(request: SimulationRequest): Headers {
    const headers = new Headers();

    for (const [ name, value ] of Object.entries(request.headers)) {
        if (typeof value === 'string') {
            headers.set(name, value);
        } else {
            const values = value ?? [];
            for (const item of values) {
                headers.append(name, item);
            }
        }
    }

    return headers;
}

async function responseBody(response: Response): Promise<Buffer> {
    const body = await response.arrayBuffer();

    return Buffer.from(body);
}

function readListenAddress(server: ServerAddressReader, host: string): ListenAddress {
    const address = server.address();

    if (typeof address !== 'object' || address === null) {
        throw new TypeError('Simulated HTTP server did not expose a TCP address.');
    }

    return {
        host,
        port: address.port
    };
}

function httpBaseUrl(address: ListenAddress): string {
    const { host, port } = address;
    const hostname = isIPv6(host) ? `[${host}]` : host;

    return `http://${hostname}:${port}`;
}

async function listen(server: ServerLifecycle, host: string, port: number): Promise<ListenAddress> {
    return await new Promise(function startListening(resolve, reject) {
        const listener = {
            reject(error: Error): void {
                server.off('listening', listener.resolve);
                reject(error);
            },
            resolve(): void {
                server.off('error', listener.reject);
                resolve(readListenAddress(server, host));
            }
        };

        server.once('error', listener.reject);
        server.once('listening', listener.resolve);
        server.listen(port, host);
    });
}

async function closeServer(server: ServerLifecycle): Promise<void> {
    await new Promise<void>(function close(resolve, reject) {
        server.close(function finish(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function webResponseHeaders(webResponse: Response): Record<string, string> {
    const headers: Record<string, string> = {};

    webResponse.headers.forEach(function recordHeader(value, name) {
        headers[name] = value;
    });

    return headers;
}

async function sendWebResponse(response: ResponseWriter, webResponse: Response): Promise<Buffer> {
    const body = await responseBody(webResponse);

    response.writeHead(webResponse.status, webResponse.statusText, webResponseHeaders(webResponse));
    response.end(body);

    return body;
}

function sendTextResponse(response: ResponseWriter, status: number, body: string): void {
    response.writeHead(status);
    response.end(body);
}

async function createWebRequest(request: SimulationRequest, url: URL): Promise<Request> {
    const body = await collectRequestBody(request);
    const init: NonNullable<ConstructorParameters<typeof Request>[1]> = {
        headers: requestHeaders(request),
        method: request.method ?? 'GET'
    };

    return body === null ? new Request(url, init) : new Request(url, { ...init, body });
}

function disposalError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new Error('Simulation handler failed with a non-error value.', { cause: error });
}

function asyncDisposeSymbol(): symbol {
    const value: unknown = Reflect.get(Symbol, 'asyncDispose');

    if (typeof value !== 'symbol') {
        throw new TypeError('Runtime does not provide Symbol.asyncDispose.');
    }

    return value;
}

type ServerDisposal = {
    readonly dispose: () => Promise<void>;
};

function isAsyncDisposable(handle: ServerDisposal): handle is AsyncDisposable & ServerDisposal {
    return Reflect.has(handle, asyncDisposeSymbol());
}

function disposableHandle<Handle extends ServerDisposal>(
    handle: Handle
): Readonly<AsyncDisposable & Handle> {
    Object.defineProperty(handle, asyncDisposeSymbol(), { value: handle.dispose });

    if (isAsyncDisposable(handle)) {
        return Object.freeze(handle);
    }

    throw new TypeError('Simulated HTTP server handle is incomplete.');
}

function requestSnapshot(request: Request, body: Uint8Array | null): HttpRequestSnapshot {
    return Object.freeze({
        body: recordedHttpBody(body),
        headers: httpHeadersSnapshot(request.headers),
        method: request.method,
        url: request.url
    });
}

type PreparedSimulationRequest<Scenario extends string | null> = {
    readonly request: Request;
    readonly scenario: Scenario;
    readonly snapshot: HttpRequestSnapshot;
};
type SimulationResponse = {
    readonly body: Buffer;
    readonly response: Response;
};

async function prepareSimulationRequest<Scenario extends string | null>(
    request: SimulationRequest,
    route: ScenarioRoute<Scenario>
): Promise<PreparedSimulationRequest<Scenario>> {
    const webRequest = await createWebRequest(request, route.url);
    const requestBody = await webRequest.clone().arrayBuffer();

    return {
        request: webRequest,
        scenario: route.scenario,
        snapshot: requestSnapshot(
            webRequest,
            requestBody.byteLength === 0 ? null : new Uint8Array(requestBody)
        )
    };
}

function recordSimulationResponse<Scenario extends string | null>(
    context: SimulationRequestContext<Scenario>,
    prepared: PreparedSimulationRequest<Scenario>,
    result: SimulationResponse,
    sequence: number
): void {
    context.transcript.record({
        context: { scenario: prepared.scenario },
        outcome: {
            kind: 'response',
            response: {
                body: recordedHttpBody(result.body),
                headers: httpHeadersSnapshot(result.response.headers),
                status: result.response.status,
                statusText: result.response.statusText
            }
        },
        request: prepared.snapshot,
        sequence
    }, context.scope);
}

async function executeSimulationRequest<Scenario extends string | null>(
    context: SimulationRequestContext<Scenario>,
    sequence: number
): Promise<void> {
    const target = context.request.url ?? '/';
    const requestUrl = target.startsWith('/') ? new URL(context.baseUrl + target) : new URL(target, context.baseUrl);
    const route = context.route(requestUrl);
    const prepared = await prepareSimulationRequest(context.request, route);

    try {
        const response = await route.respond(prepared.request);
        const body = await sendWebResponse(context.response, response);
        recordSimulationResponse(context, prepared, { body, response }, sequence);
    } catch (error: unknown) {
        context.transcript.record({
            context: { scenario: prepared.scenario },
            outcome: { error: recordedHttpError(error), kind: 'error' },
            request: prepared.snapshot,
            sequence
        }, context.scope);
        throw error;
    }
}

function reportSimulationFailure<Scenario extends string | null>(
    context: SimulationRequestContext<Scenario>,
    error: unknown
): void {
    try {
        context.recordError(error);
        sendTextResponse(context.response, handlerFailureStatus, 'Simulation handler failed.');
    } catch (responseError: unknown) {
        context.recordError(responseError);
    }
}

export async function serveSimulatedHttpRequest<Scenario extends string | null>(
    context: SimulationRequestContext<Scenario>
): Promise<void> {
    const sequence = context.transcript.nextSequence();

    try {
        await executeSimulationRequest(context, sequence);
    } catch (error: unknown) {
        reportSimulationFailure(context, error);
    }
}

function startGuardedRoute(routePromise: Promise<void>): void {
    Reflect.get(routePromise, Symbol.toStringTag);
}

function createServer<Scenario extends string | null>(
    options: SimulationServerOptions<Scenario>
): http.Server {
    const server = http.createServer(function handleRequest(request, response) {
        startGuardedRoute(
            serveSimulatedHttpRequest({
                request: {
                    method: request.method,
                    url: request.url,
                    headers: request.headers,
                    on: request.on.bind(request)
                },
                response,
                route: options.route,
                baseUrl: httpBaseUrl(readListenAddress(server, options.host)),
                recordError: options.recordError,
                scope: options.scope,
                transcript: options.transcript
            })
        );
    });

    return server;
}

async function listenBaseUrl(server: ServerLifecycle, host: string, port: number): Promise<string> {
    return httpBaseUrl(await listen(server, host, port));
}

function createHandlerErrors(): HandlerErrors {
    const errors: unknown[] = [];

    return {
        errors,
        record(error) {
            errors.push(error);
        }
    };
}

function createServerDisposal(server: ServerLifecycle, handlerErrors: readonly unknown[]): () => Promise<void> {
    let disposal: Promise<void> | null = null;

    return async function disposeServer(): Promise<void> {
        if (disposal === null) {
            disposal = closeServer(server);
        }

        await disposal;

        if (handlerErrors[0] !== undefined) {
            throw disposalError(handlerErrors[0]);
        }
    };
}

function createListeningServer<Scenario extends string | null>(
    route: ScenarioRouting<Scenario>,
    host: string
): SimulatedHttpListeningServer<Scenario> {
    const handlerErrors = createHandlerErrors();
    const transcript = createHttpTranscriptRecorder<{ readonly scenario: Scenario; }>();
    const server = createServer({
        host,
        recordError: handlerErrors.record,
        scope: currentTranscriptScope(),
        route,
        transcript
    });

    return {
        errors: handlerErrors.errors,
        server,
        transcript: transcript.transcript
    };
}

export function createSimulatedHttpListeningServer<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    host: string
): SimulatedHttpListeningServer {
    assertRoutableScenarios(simulation.scenarios);

    return createListeningServer(requestRoutedScenario(simulation), host);
}

export function assertNoSimulatedHttpHandlerErrors(handlerErrors: readonly unknown[]): void {
    if (handlerErrors[0] !== undefined) {
        throw disposalError(handlerErrors[0]);
    }
}

async function listenToServer<Scenario extends string | null>(
    listener: SimulatedHttpListeningServer<Scenario>,
    host: string,
    port: number
): Promise<ListeningHandle<Scenario>> {
    const baseUrl = await listenBaseUrl(listener.server, host, port);

    return {
        baseUrl,
        dispose: createServerDisposal(listener.server, listener.errors),
        transcript: listener.transcript
    };
}

export async function listenToSimulatedHttpServer<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerOptions<Name, Scenarios>,
    createListener: (
        simulation: SimulatedHttpServerDefinition<string, Scenarios>,
        host: string
    ) => SimulatedHttpListeningServer
): Promise<SimulatedHttpServerHandle<SimulatedHttpServerDefinition<Name, Scenarios>>> {
    if (!isDefinedSimulatedHttpServer(options.simulation)) {
        throw new TypeError('startSimulatedHttpServer() requires a simulated HTTP server definition.');
    }

    const host = options.host ?? '127.0.0.1';
    const listener = createListener(options.simulation, host);
    const handle = await listenToServer(listener, host, options.port ?? 0);

    return disposableHandle({
        ...handle,
        baseUrl: simulatedHttpScenarioUrl(handle.baseUrl, 'default', '/'),
        scenarioUrl(scenario: string & keyof Scenarios, path: string) {
            return simulatedHttpScenarioUrl(handle.baseUrl, scenario, path);
        }
    });
}

export async function startSimulatedHttpServer<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerOptions<Name, Scenarios>
): Promise<SimulatedHttpServerHandle<SimulatedHttpServerDefinition<Name, Scenarios>>> {
    return await listenToSimulatedHttpServer(options, createSimulatedHttpListeningServer);
}

export async function startFixedSimulatedHttpServer<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: FixedSimulatedHttpServerOptions<Name, Scenarios>
): Promise<FixedSimulatedHttpServerHandle> {
    if (!isDefinedSimulatedHttpServer(options.simulation)) {
        throw new TypeError('startFixedSimulatedHttpServer() requires a simulated HTTP server definition.');
    }

    const route = fixedScenario(options.simulation, options.scenario);
    const host = options.host ?? '127.0.0.1';
    const listener = createListeningServer(route, host);

    return disposableHandle(await listenToServer(listener, host, options.port ?? 0));
}
