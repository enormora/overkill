import diagnostics from 'node:diagnostics_channel';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    observeLocalHttpServer,
    type LocalHttpTranscriptObserver
} from '../resources/local-http-transcript-observer.ts';

export type HttpObservationFixture = {
    readonly observer: LocalHttpTranscriptObserver;
    readonly incoming: IncomingMessage;
    readonly request: { readonly origin: string; readonly path: string; readonly method: string; };
    readonly start: () => void;
    readonly finish: () => void;
    readonly publish: (name: string, message: unknown) => void;
};
function incomingRequest(socket: Socket): IncomingMessage {
    const incoming = new IncomingMessage(socket);
    incoming.method = 'POST';
    incoming.url = '/value';
    incoming.headers = { 'x-request': [ 'one', 'two' ], unused: undefined };
    return incoming;
}

export function httpObservationFixture(scope: TestScope): HttpObservationFixture {
    const socket = new Socket();
    const incoming = incomingRequest(socket);
    const server = {};
    const observer = observeLocalHttpServer(server, 'https://service.test:42', 'attempt');
    const response = {
        statusCode: 200,
        statusMessage: undefined,
        getHeaders() {
            return { 'X-Reply': [ 'one', 'two' ], 'X-Count': 3, unused: undefined };
        }
    };
    scope.cleanup(observer.dispose);
    scope.cleanup(function disposeRequest() {
        incoming.destroy();
        socket.destroy();
    });
    return {
        observer,
        incoming,
        request: { origin: 'https://service.test:42', path: '/value', method: 'POST' },
        start() {
            diagnostics.channel('http.server.request.start').publish({ server, request: incoming, response });
        },
        finish() {
            diagnostics.channel('http.server.response.finish').publish({ server, request: incoming, response });
        },
        publish(name, message) {
            diagnostics.channel(name).publish(message);
        }
    };
}
