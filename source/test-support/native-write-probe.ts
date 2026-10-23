import { connect, createServer, type Server, type Socket } from 'node:net';
import type { TestScope } from '../engine/test-node.ts';

export type NativeWriteProbe = {
    readonly write: () => Promise<void>;
    readonly pause: () => void;
    readonly drain: () => void;
};

type WriteListener = {
    readonly server: Server;
    readonly retainSocket: (socket: Socket) => void;
    readonly accepted: Promise<Socket>;
};

const pendingWriteBytes = 16_777_216;

function closeWriteListener(scope: TestScope, server: Server, sockets: ReadonlySet<Socket>): void {
    scope.cleanup(async function closeWriteProbe() {
        for (const socket of sockets) {
            socket.destroy();
        }
        await new Promise<void>(function closeServer(resolve, reject) {
            server.close(function closed(error) {
                if (error === undefined) {
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
    });
}

async function listenForWriteProbe(scope: TestScope): Promise<WriteListener> {
    const accepted = Promise.withResolvers<Socket>();
    const sockets = new Set<Socket>();
    const server = createServer(function accept(socket) {
        sockets.add(socket);
        accepted.resolve(socket);
    });
    closeWriteListener(scope, server, sockets);
    await new Promise<void>(function listen(resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        server,
        accepted: accepted.promise,
        retainSocket(socket) {
            sockets.add(socket);
        }
    };
}

async function connectWriteProbe(
    listener: WriteListener
): Promise<{ readonly socket: Socket; readonly peer: Socket; }> {
    const address = listener.server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Native write probe has no TCP address.');
    }
    const socket = connect(address.port, '127.0.0.1');
    listener.retainSocket(socket);
    await new Promise<void>(function connected(resolve, reject) {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    return { socket, peer: await listener.accepted };
}

async function writeProbeBytes(socket: Socket): Promise<void> {
    await new Promise<void>(function writeBytes(resolve, reject) {
        socket.write(Buffer.alloc(pendingWriteBytes), function written(error) {
            if (error === undefined || error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

export async function createNativeWriteProbe(scope: TestScope): Promise<NativeWriteProbe> {
    const listener = await listenForWriteProbe(scope);
    const { socket, peer } = await connectWriteProbe(listener);
    peer.pause();
    return {
        async write() {
            await writeProbeBytes(socket);
        },
        pause() {
            peer.pause();
        },
        drain() {
            peer.resume();
        }
    };
}
