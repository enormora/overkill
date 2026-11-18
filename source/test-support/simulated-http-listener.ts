import { EventEmitter } from 'node:events';
import { createHttpTranscriptRecorder } from '../transcript/http-transcript.ts';
import type { SimulatedHttpListeningServer } from '../simulation/simulated-http-server.ts';

type ListenerScenario = {
    readonly address: string | { readonly port: number; } | null;
    readonly listenError: Error | null;
    readonly closeError: Error | null;
    readonly handlerErrors: readonly unknown[];
};
export const simulatedListenerScenario: ListenerScenario = {
    address: { port: 1234 },
    listenError: null,
    closeError: null,
    handlerErrors: []
};
type SimulatedHttpListener = {
    readonly listening: SimulatedHttpListeningServer;
    readonly calls: readonly string[];
    readonly emitter: EventEmitter;
};
export function simulatedHttpListener(input: ListenerScenario): SimulatedHttpListener {
    const emitter = new EventEmitter();
    const calls: string[] = [];
    const listening: SimulatedHttpListeningServer = {
        errors: input.handlerErrors,
        transcript: createHttpTranscriptRecorder<{ readonly scenario: string; }>().transcript,
        server: {
            listening: false,
            address() {
                return input.address;
            },
            listen(port, host) {
                calls.push(`listen:${host}:${port}`);
                if (input.listenError === null) {
                    emitter.emit('listening');
                } else {
                    emitter.emit('error', input.listenError);
                }
            },
            close(callback) {
                calls.push('close');
                callback(input.closeError ?? undefined);
            },
            once: emitter.once.bind(emitter),
            off: emitter.off.bind(emitter)
        }
    };
    return { listening, calls, emitter };
}
