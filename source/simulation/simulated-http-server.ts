import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
    isDefinedSimulatedHttpServer,
    type SimulatedHttpServerDefinition,
    type SimulationScenarioCatalog
} from './simulation.ts';

const scenarioQueryParameterName = '__overkill_scenario';
const unknownScenarioStatus = 400;
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

export type SimulatedHttpServerHandle<Simulation extends SimulationWithScenarios> = AsyncDisposable & {
    readonly baseUrl: string;
    readonly dispose: () => Promise<void>;
    readonly scenarioUrl: (scenario: string & keyof Simulation['scenarios'], path: string) => string;
};

type ListenAddress = {
    readonly host: string;
    readonly port: number;
};
type ServerAddressReader = Readonly<Pick<http.Server, 'address'>>;
type ServerLifecycle = Readonly<Pick<http.Server, 'address' | 'close' | 'listen' | 'off' | 'once'>>;
type ResponseWriter = Readonly<Pick<ServerResponse, 'end' | 'writeHead'>>;
type SimulatedHttpServerHandleCandidate<Simulation extends SimulationWithScenarios> = {
    readonly baseUrl: string;
    readonly dispose: () => Promise<void>;
    readonly scenarioUrl: (scenario: string & keyof Simulation['scenarios'], path: string) => string;
};
type SimulationRequestContext<Scenarios extends SimulationScenarioCatalog> = {
    readonly baseUrl: string;
    readonly recordError: (error: unknown) => void;
    readonly request: IncomingMessage;
    readonly response: ResponseWriter;
    readonly simulation: SimulatedHttpServerDefinition<string, Scenarios>;
};
type HandlerErrors = {
    readonly errors: readonly unknown[];
    readonly record: (error: unknown) => void;
};
type ListeningServer = {
    readonly errors: readonly unknown[];
    readonly server: http.Server;
};

function asyncDisposeSymbol(): symbol {
    const value = Reflect.get(Symbol, 'asyncDispose');

    if (typeof value !== 'symbol') {
        throw new TypeError('Runtime does not provide Symbol.asyncDispose.');
    }

    return value;
}

async function collectRequestBody(request: IncomingMessage): Promise<Uint8Array | null> {
    if (request.method === 'GET' || request.method === 'HEAD') {
        return null;
    }

    return await new Promise(function collectBody(resolve, reject) {
        const chunks: Buffer[] = [];

        request.on('data', function recordChunk(chunk: Buffer) {
            chunks.push(chunk);
        });
        request.on('error', reject);
        request.on('end', function resolveBody() {
            resolve(Buffer.concat(chunks));
        });
    });
}

function requestHeaders(request: IncomingMessage): Headers {
    const headers = new Headers();

    for (const [ name, value ] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                headers.append(name, item);
            }
        } else if (value !== undefined) {
            headers.set(name, value);
        }
    }

    return headers;
}

async function responseBody(response: Response): Promise<Buffer> {
    const body = await response.arrayBuffer();

    return Buffer.from(body);
}

function scenarioUrl(baseUrl: string, scenario: string, path: string): string {
    const url = new URL(path, baseUrl);

    url.searchParams.set(scenarioQueryParameterName, scenario);

    return url.href;
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

function serverBaseUrl(server: ServerAddressReader, host: string): string {
    const listenAddress = readListenAddress(server, host);

    return `http://${listenAddress.host}:${listenAddress.port}`;
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

async function sendWebResponse(response: ResponseWriter, webResponse: Response): Promise<void> {
    const body = await responseBody(webResponse);

    response.writeHead(webResponse.status, webResponse.statusText, webResponseHeaders(webResponse));
    response.end(body);
}

function sendTextResponse(response: ResponseWriter, status: number, body: string): void {
    response.writeHead(status);
    response.end(body);
}

async function createWebRequest(request: IncomingMessage, baseUrl: string): Promise<{
    readonly request: Request;
    readonly scenario: string;
}> {
    const requestUrl = new URL(request.url ?? '/', baseUrl);
    const scenario = requestUrl.searchParams.get(scenarioQueryParameterName) ?? 'default';

    requestUrl.searchParams.delete(scenarioQueryParameterName);

    const body = await collectRequestBody(request);
    const init: NonNullable<ConstructorParameters<typeof Request>[1]> = {
        headers: requestHeaders(request),
        method: request.method ?? 'GET'
    };

    return {
        request: body === null ? new Request(requestUrl, init) : new Request(requestUrl, { ...init, body }),
        scenario
    };
}

function disposalError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new Error('Simulation handler failed with a non-error value.', { cause: error });
}

function isSimulatedHttpServerHandle<Simulation extends SimulationWithScenarios>(
    handle: SimulatedHttpServerHandleCandidate<Simulation>
): handle is SimulatedHttpServerHandle<Simulation> {
    return Reflect.has(handle, asyncDisposeSymbol());
}

function simulatedHttpServerHandle<Simulation extends SimulationWithScenarios>(
    baseUrl: string,
    disposeServer: () => Promise<void>
): SimulatedHttpServerHandle<Simulation> {
    const handle = {
        baseUrl,
        scenarioUrl(scenario: string & keyof Simulation['scenarios'], path: string) {
            return scenarioUrl(baseUrl, scenario, path);
        },
        dispose: disposeServer
    };

    Object.defineProperty(handle, asyncDisposeSymbol(), { value: disposeServer });

    const frozenHandle = Object.freeze(handle);

    if (isSimulatedHttpServerHandle<Simulation>(frozenHandle)) {
        return frozenHandle;
    }

    throw new TypeError('Simulated HTTP server handle is incomplete.');
}

async function respondToSimulationRequest<Scenarios extends SimulationScenarioCatalog>(
    response: ResponseWriter,
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    request: Request,
    scenario: string
): Promise<void> {
    if (!Object.hasOwn(simulation.scenarios, scenario)) {
        sendTextResponse(response, unknownScenarioStatus, 'Unknown simulation scenario.');

        return;
    }

    const scenarioKey = scenario as string & keyof Scenarios;
    const descriptor = simulation.scenarios[scenarioKey];

    await sendWebResponse(
        response,
        await simulation.handle(request, { descriptor, key: scenarioKey })
    );
}

async function routeSimulationRequest<Scenarios extends SimulationScenarioCatalog>(
    context: SimulationRequestContext<Scenarios>
): Promise<void> {
    try {
        const webRequest = await createWebRequest(context.request, context.baseUrl);

        await respondToSimulationRequest(
            context.response,
            context.simulation,
            webRequest.request,
            webRequest.scenario
        );
    } catch (error: unknown) {
        try {
            context.recordError(error);
            sendTextResponse(context.response, handlerFailureStatus, 'Simulation handler failed.');
        } catch (responseError: unknown) {
            context.recordError(responseError);
        }
    }
}

function startGuardedRoute(routePromise: Promise<void>): void {
    Reflect.get(routePromise, Symbol.toStringTag);
}

function createServer<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    host: string,
    recordError: (error: unknown) => void
): http.Server {
    const server = http.createServer(function handleRequest(request, response) {
        startGuardedRoute(
            routeSimulationRequest({
                request,
                response,
                simulation,
                baseUrl: serverBaseUrl(server, host),
                recordError
            })
        );
    });

    return server;
}

async function listenBaseUrl(server: ServerLifecycle, host: string, port: number): Promise<string> {
    const listenAddress = await listen(server, host, port);

    return `http://${listenAddress.host}:${listenAddress.port}`;
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

function createListeningServer<Scenarios extends SimulationScenarioCatalog>(
    simulation: SimulatedHttpServerDefinition<string, Scenarios>,
    host: string
): ListeningServer {
    const handlerErrors = createHandlerErrors();
    const server = createServer(simulation, host, handlerErrors.record);

    return {
        errors: handlerErrors.errors,
        server
    };
}

export async function startSimulatedHttpServer<
    const Name extends string,
    const Scenarios extends SimulationScenarioCatalog
>(
    options: SimulatedHttpServerOptions<Name, Scenarios>
): Promise<SimulatedHttpServerHandle<SimulatedHttpServerDefinition<Name, Scenarios>>> {
    if (!isDefinedSimulatedHttpServer(options.simulation)) {
        throw new TypeError('startSimulatedHttpServer() requires a simulated HTTP server definition.');
    }

    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 0;
    const listeningServer = createListeningServer(options.simulation, host);
    const baseUrl = await listenBaseUrl(listeningServer.server, host, port);
    const disposeServer = createServerDisposal(listeningServer.server, listeningServer.errors);

    return simulatedHttpServerHandle<SimulatedHttpServerDefinition<Name, Scenarios>>(baseUrl, disposeServer);
}
