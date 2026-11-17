import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import {
    createResourceCheckRegistry,
    type ResourceCheckRegistry,
    type ResourceCheckSend
} from './resource-check-registry.ts';
import { resourceCheckChannel, type ResourceCheckEndpoint, type ResourceCheckFrame } from './resource-check-channel.ts';

export type ResourceCheckBroker = {
    readonly endpoint: ResourceCheckEndpoint;
    readonly snapshots: () => readonly ResourceCheckSnapshot[];
    readonly observe: (listener: (snapshot: ResourceCheckSnapshot) => void) => void;
};
const brokers = new AsyncLocalStorage<ResourceCheckBroker>();
export function currentResourceCheckBroker(): ResourceCheckBroker | null {
    return brokers.getStore() ?? null;
}
async function listen(server: Server): Promise<number> {
    await new Promise<void>(function start(resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Resource check server has no TCP address.');
    }
    return address.port;
}
async function close(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
    for (const socket of sockets) {
        socket.destroy();
    }
    await new Promise<void>(function stop(resolve) {
        server.close(function closed() {
            resolve();
        });
    });
}
async function receiveRequest(
    registry: ResourceCheckRegistry,
    socket: Socket,
    send: ResourceCheckSend,
    frame: ResourceCheckFrame
): Promise<void> {
    try {
        await registry.receive(socket, send, frame);
    } catch {
        socket.destroy();
    }
}
function createBrokerServer(
    token: string,
    registry: ResourceCheckRegistry,
    sockets: Connections
): Server {
    return createServer(function accept(socket) {
        sockets.add(socket);
        const send = resourceCheckChannel(socket, token, async function receive(frame) {
            return receiveRequest(registry, socket, send, frame);
        });
        registry.connect(socket, send);
        socket.once('close', function disconnected() {
            sockets.delete(socket);
            registry.disconnect(socket);
        });
    });
}
export async function withResourceCheckBroker<Value>(operation: () => Promise<Value>): Promise<Value> {
    const token = randomUUID();
    const registry = createResourceCheckRegistry(token);
    const sockets = new Set<Socket>();
    const server = createBrokerServer(token, registry, sockets);
    const broker: ResourceCheckBroker = {
        endpoint: { port: await listen(server), token },
        snapshots: registry.snapshots,
        observe: registry.observe
    };
    try {
        return await brokers.run(broker, operation);
    } finally {
        await close(server, sockets);
    }
}

type Connections = {
    readonly add: (socket: Socket) => void;
    readonly delete: (socket: Socket) => boolean;
};
