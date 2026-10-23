import { createChildProcessOutbox, type ChildProcessOutbox } from '../run/child-process-outbox.ts';
import type { ChildProcessEnvelope } from '../run/child-process-protocol.ts';

export type OutboxFixture = {
    readonly outbox: ChildProcessOutbox;
    readonly complete: (message: unknown, error: Error | null) => void;
    readonly disconnected: () => boolean;
    readonly messages: readonly ChildProcessEnvelope<unknown>[];
};

export function delayedOutbox(queued: readonly string[]): OutboxFixture {
    const messages: ChildProcessEnvelope<unknown>[] = [];
    const deliveries = new Map<unknown, (error: Error | null) => void>();
    let disconnected = false;

    const fixture: OutboxFixture = {
        outbox: createChildProcessOutbox('test', {
            disconnect() {
                disconnected = true;
            },
            send(message, complete) {
                messages.push(message);
                deliveries.set(message.message, complete);
                return false;
            }
        }),
        complete(message, error) {
            const complete = deliveries.get(message);
            if (complete === undefined) {
                throw new Error('Message was not sent.');
            }
            complete(error);
        },
        disconnected() {
            return disconnected;
        },
        messages
    };
    queued.forEach(fixture.outbox.send);
    return fixture;
}
