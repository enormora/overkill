import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { TestScope } from '@overkill-dev/test';
import { createStoredValue } from '../stored-value.ts';
import { type HttpTranscript, createHttpTranscriptRecorder } from '../transcript/http-transcript.ts';
import { currentTranscriptScope } from '../transcript/transcript-store.ts';

import type { SimulatedHttpServerDefinition, SimulationScenarioCatalog } from '../simulation/simulation.ts';
import { serveSimulatedHttpRequest } from '../simulation/simulated-http-server.ts';

type ResponseState = {
    readonly status: number | null;
    readonly statusText: string | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array | string | null;
};
type ResponseHeadWithHeaders = readonly [status: number, statusText: string, headers: Readonly<Record<string, string>>];
type ResponseHeadArguments = ResponseHeadWithHeaders | readonly [status: number];
type SimulatedHttpFixture = {
    readonly request: IncomingMessage;
    readonly response: ResponseState;
    readonly errors: readonly unknown[];
    readonly transcript: HttpTranscript<{ readonly scenario: string; }>;
    readonly serve: () => Promise<void>;
    readonly failResponse: (failure: Error) => void;
};
export function simulatedHttpRequest<Scenarios extends SimulationScenarioCatalog>(
    cleanup: TestScope['cleanup'],
    simulation: SimulatedHttpServerDefinition<string, Scenarios>
): SimulatedHttpFixture {
    const socket = new Socket();
    const request = new IncomingMessage(socket);
    request.method = 'GET';
    request.url = '/resource';
    const response = createStoredValue<ResponseState>({ status: null, statusText: null, headers: {}, body: null });
    const errors: unknown[] = [];
    let responseFailure: Error | null = null;
    const transcript = createHttpTranscriptRecorder<{ readonly scenario: string; }>();
    cleanup(function () {
        request.destroy();
        socket.destroy();
    });
    return {
        request,
        get response() {
            return response.read();
        },
        errors,
        failResponse(failure) {
            responseFailure = failure;
        },
        transcript: transcript.transcript,
        async serve() {
            await serveSimulatedHttpRequest({
                baseUrl: 'https://service.test:42',
                request: {
                    method: request.method,
                    url: request.url,
                    headers: request.headers,
                    on: request.on.bind(request)
                },
                simulation,
                transcript,
                scope: currentTranscriptScope(),
                recordError(error) {
                    errors.push(error);
                },
                response: {
                    writeHead(...args: ResponseHeadArguments) {
                        if (responseFailure !== null) {
                            throw responseFailure;
                        }
                        const [ status, statusText = null, headers = {} ] = args;
                        response.write({ ...response.read(), status, statusText, headers });
                    },
                    end(body) {
                        response.write({ ...response.read(), body });
                    }
                }
            });
        }
    };
}
