import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import type { AttachmentServerRuntime, AttachmentServerStore } from '../run/attachment-server.ts';
import type { AttachmentOperation, AttachmentOwner } from '../run/attachment-protocol.ts';
import type { TestScope } from '@overkill-dev/test';

type AttachmentListenerScenario = {
    readonly start: Error | null;
    readonly exchange: Error | null;
    readonly write: Error | null;
    readonly close: Error | null;
    readonly address: 'missing' | 'path' | 'port';
    readonly abandoned: boolean;
};
export const attachmentListenerScenario: AttachmentListenerScenario = {
    start: null,
    exchange: null,
    write: null,
    close: null,
    address: 'port',
    abandoned: false
};
type AttachmentListenerSocket = {
    readonly socket: Duplex;
    readonly replies: readonly unknown[];
    readonly nextReply: () => Promise<unknown>;
    readonly deliver: (line: string) => void;
    readonly closed: () => Promise<void>;
};
type AttachmentListenerFixture = {
    readonly runtime: AttachmentServerRuntime;
    readonly store: AttachmentServerStore;
    readonly events: readonly string[];
    readonly operations: readonly AttachmentOperation[];
    readonly finished: readonly (string | null)[];
    readonly connect: () => AttachmentListenerSocket;
};
export function attachmentListener(scope: TestScope, scenario: AttachmentListenerScenario): AttachmentListenerFixture {
    const events: string[] = [];
    const operations: AttachmentOperation[] = [];
    const finished: (string | null)[] = [];
    const sockets: Duplex[] = [];
    const closures = new Map<Duplex, Promise<undefined>>();
    const serverEvents = new EventEmitter();
    let identity = 0;
    let accept: (socket: Duplex) => void = function () {
        throw new Error('Attachment listener was not started.');
    };
    scope.cleanup(async function () {
        for (const socket of sockets) {
            socket.destroy();
        }
        await Promise.all(closures.values());
    });
    return {
        events,
        operations,
        finished,
        store: {
            async exchange(_channel, operation) {
                operations.push(operation);
                if (scenario.exchange !== null) {
                    throw scenario.exchange;
                }
                return { kind: 'written' };
            },
            async finish(channel) {
                finished.push(channel);
                const owners: readonly AttachmentOwner[] = channel !== null && scenario.abandoned
                    ? [ { kind: 'run' } ]
                    : [];
                return owners;
            }
        },
        runtime: {
            identity() {
                identity += 1;
                return `identity-${identity}`;
            },
            create(receive) {
                accept = receive;
                return {
                    once: serverEvents.once.bind(serverEvents),
                    listen(_port, _host, ready) {
                        events.push('listen');
                        if (scenario.start === null) {
                            ready();
                        } else {
                            serverEvents.emit('error', scenario.start);
                        }
                    },
                    address() {
                        if (scenario.address === 'missing') {
                            return null;
                        }
                        return scenario.address === 'path' ? '/socket' : { port: 4321 };
                    },
                    async close(callback) {
                        events.push('close');
                        const failure = scenario.close ?? undefined;
                        try {
                            await Promise.all(closures.values());
                            callback(failure);
                        } catch (error: unknown) {
                            callback(
                                error instanceof Error ? error : new Error('Socket close failed.', { cause: error })
                            );
                        }
                    }
                };
            }
        },
        connect() {
            const replies: unknown[] = [];
            const delivery = new EventEmitter();
            const socket = new Duplex({
                read() {
                    return undefined;
                },
                write(chunk: Buffer, _encoding, callback) {
                    const reply: unknown = JSON.parse(chunk.toString());
                    replies.push(reply);
                    delivery.emit('reply', reply);
                    callback(scenario.write);
                }
            });
            const closing = Promise.withResolvers<undefined>();
            socket.once('close', function () {
                closing.resolve(undefined);
            });
            closures.set(socket, closing.promise);
            sockets.push(socket);
            accept(socket);
            return {
                socket,
                replies,
                async nextReply() {
                    return await new Promise<unknown>(function receiveReply(resolve) {
                        delivery.once('reply', resolve);
                    });
                },
                deliver(line) {
                    socket.push(`${line}\n`);
                },
                async closed() {
                    await closing.promise;
                }
            };
        }
    };
}
