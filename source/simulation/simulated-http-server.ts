import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
    isDefinedSimulatedHttpServer,
    type SimulatedHttpServerDefinition,
    type SimulationScenarioCatalog
} from './simulation.ts';

const scenarioQueryParameterName = '__overkill_scenario';

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
    readonly scenarioUrl: (scenario: keyof Simulation['scenarios'] & string, path: string) => string;
};

type ListenAddress = {
    readonly host: string;
    readonly port: number;
};

function collectRequestBody(request: IncomingMessage): Promise<Uint8Array | null> {
    if (request.method === 'GET' || request.method === 'HEAD') {
        return Promise.resolve(null);
    }

    return new Promise(function collectBody(resolve, reject) {
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

function responseBody(response: Response): Promise<Buffer> {
    return response.arrayBuffer().then(function toBuffer(body) {
        return Buffer.from(body);
    });
}

function scenarioUrl(baseUrl: string, scenario: string, path: string): string {
    const url = new URL(path, baseUrl);

    url.searchParams.set(scenarioQueryParameterName, scenario);

    return url.href;
}

function readListenAddress(server: http.Server, host: string): ListenAddress {
    const address = server.address();

    if (typeof address !== 'object' || address === null) {
        throw new TypeError('Simulated HTTP server did not expose a TCP address.');
    }

    return {
        host,
        port: address.port
    };
}

function listen(server: http.Server, host: string, port: number): Promise<ListenAddress> {
    return new Promise(function startListening(resolve, reject) {
        function rejectListen(error: Error): void {
            server.off('listening', resolveListen);
            reject(error);
        }

        function resolveListen(): void {
            server.off('error', rejectListen);
            resolve(readListenAddress(server, host));
        }

        server.once('error', rejectListen);
        server.once('listening', resolveListen);
        server.listen(port, host);
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise(function close(resolve, reject) {
        server.close(function finish(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function sendWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
    response.statusCode = webResponse.status;
    response.statusMessage = webResponse.statusText;
    webResponse.headers.forEach(function setHeader(value, name) {
        response.setHeader(name, value);
    });
    response.end(await responseBody(webResponse));
}

async function createWebRequest(request: IncomingMessage, baseUrl: string): Promise<{
    readonly request: Request;
    readonly scenario: string;
}> {
    const requestUrl = new URL(request.url ?? '/', baseUrl);
    const scenario = requestUrl.searchParams.get(scenarioQueryParameterName) ?? 'default';

    requestUrl.searchParams.delete(scenarioQueryParameterName);

    const body = await collectRequestBody(request);
    const init: RequestInit = {
        headers: requestHeaders(request),
        method: request.method ?? 'GET'
    };

    return {
        request: body === null ? new Request(requestUrl, init) : new Request(requestUrl, { ...init, body }),
        scenario
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
    const handlerErrors: unknown[] = [];
    let baseUrl = '';
    const server = http.createServer(function handleRequest(request, response) {
        void (async function respond() {
            const webRequest = await createWebRequest(request, baseUrl);

            if (!Object.hasOwn(options.simulation.scenarios, webRequest.scenario)) {
                response.statusCode = 400;
                response.end('Unknown simulation scenario.');

                return;
            }

            const scenario = webRequest.scenario as keyof Scenarios & string;
            const descriptor = options.simulation.scenarios[scenario];

            try {
                await sendWebResponse(
                    response,
                    await options.simulation.handle(webRequest.request, { descriptor, key: scenario })
                );
            } catch (error) {
                handlerErrors.push(error);
                response.statusCode = 500;
                response.end('Simulation handler failed.');
            }
        })().catch(function handleAdapterError(error) {
            handlerErrors.push(error);
            response.statusCode = 500;
            response.end('Simulation handler failed.');
        });
    });
    const listenAddress = await listen(server, host, port);

    baseUrl = `http://${listenAddress.host}:${listenAddress.port}`;

    let disposal: Promise<void> | null = null;
    async function disposeServer(): Promise<void> {
        if (disposal === null) {
            disposal = closeServer(server);
        }

        await disposal;

        if (handlerErrors[0] !== undefined) {
            throw handlerErrors[0];
        }
    }

    const handle: SimulatedHttpServerHandle<SimulatedHttpServerDefinition<Name, Scenarios>> = {
        baseUrl,
        scenarioUrl(scenario, path) {
            return scenarioUrl(baseUrl, scenario, path);
        },
        dispose: disposeServer,
        [Symbol.asyncDispose]: disposeServer
    };

    return Object.freeze(handle);
}
