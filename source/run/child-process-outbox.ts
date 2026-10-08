import { childProcessEnvelope, type ChildProcessEnvelope } from './child-process-protocol.ts';

export type ChildProcessOutbox = {
    readonly send: (message: unknown) => void;
    readonly disconnect: () => Promise<void>;
};

export type SendChildProcessMessage = (
    message: ChildProcessEnvelope<unknown>,
    complete: (error: Error | null) => void
) => boolean;
type ChildProcessIpc = {
    readonly send: SendChildProcessMessage | null;
    readonly disconnect: (() => void) | null;
};

export function createChildProcessOutbox(correlationId: string, ipc: ChildProcessIpc): ChildProcessOutbox {
    const pending = new Set<Promise<null>>();
    let failure: Error | null = null;

    return {
        send(message) {
            const delivery = Promise.withResolvers<null>();
            pending.add(delivery.promise);
            function complete(error: Error | null): void {
                failure = failure ?? error;
                pending.delete(delivery.promise);
                delivery.resolve(null);
            }
            if (ipc.send === null) {
                complete(null);
                return;
            }
            try {
                ipc.send(childProcessEnvelope(correlationId, message), complete);
            } catch (error: unknown) {
                complete(error instanceof Error ? error : new Error('Child IPC send failed.', { cause: error }));
            }
        },
        async disconnect() {
            while (pending.size > 0) {
                await Promise.all(pending);
            }
            ipc.disconnect?.();
            if (failure !== null) {
                throw failure;
            }
        }
    };
}
