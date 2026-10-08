import type { WorkerPoolMessage } from '../run/worker-pool-protocol.ts';

export type WorkerMessagePortFixture = {
    readonly emit: (message: unknown) => void;
    readonly on: (event: 'message', listener: (message: unknown) => void) => void;
    readonly off: (event: 'message', listener: (message: unknown) => void) => void;
    readonly messages: () => readonly WorkerPoolMessage[];
    readonly postMessage: (message: WorkerPoolMessage) => void;
};

export function createWorkerMessagePortFixture(): WorkerMessagePortFixture {
    const listeners = new Set<(message: unknown) => void>();
    const messages: WorkerPoolMessage[] = [];

    return {
        emit(message) {
            for (const listener of listeners) {
                listener(message);
            }
        },
        on(_event, listener) {
            listeners.add(listener);
        },
        off(_event, listener) {
            listeners.delete(listener);
        },
        messages() {
            return messages;
        },
        postMessage(message) {
            messages.push(message);
        }
    };
}
