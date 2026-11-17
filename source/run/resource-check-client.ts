import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createClock } from '@enormora/clock';
import { withResourceCheckDelivery, type ResourceCheckDelivery } from '../resource-check-delivery.ts';
import type { ResourceCheckInterval } from '../resource-check-protocol.ts';
import { resourceCheckChannel, type ResourceCheckEndpoint } from './resource-check-channel.ts';
import {
    createResourceCheckSession,
    type ResourceCheckRequest,
    type ResourceCheckResponse
} from './resource-check-session.ts';

export type ResourceCheckClient = {
    readonly delivery: ResourceCheckDelivery;
    readonly exchange: (frame: ResourceCheckRequest) => Promise<ResourceCheckResponse>;
    readonly socket: Socket;
};
const clients = new Map<string, ResourceCheckClient>();
function createClient(endpoint: ResourceCheckEndpoint): ResourceCheckClient {
    const socket = createConnection({ port: endpoint.port, host: '127.0.0.1' });
    const session = createResourceCheckSession(endpoint.token, socket, createClock());
    session.connect(resourceCheckChannel(socket, endpoint.token, session.receive));
    socket.once('close', function disconnected() {
        clients.delete(endpoint.token);
        session.disconnected();
    });
    socket.unref();
    return { socket, delivery: session.delivery, exchange: session.exchange };
}
export function resourceCheckClient(endpoint: ResourceCheckEndpoint): ResourceCheckClient {
    const existing = clients.get(endpoint.token);
    if (existing !== undefined) {
        return existing;
    }
    const client = createClient(endpoint);
    clients.set(endpoint.token, client);
    return client;
}
export async function withWorkerResourceChecks<Value>(
    endpoint: null | ResourceCheckEndpoint,
    operation: () => Promise<Value>
): Promise<Value> {
    if (endpoint === null) {
        return await operation();
    }
    const client = resourceCheckClient(endpoint);
    return await withResourceCheckDelivery(client.delivery, async function runObservedTask() {
        try {
            return await operation();
        } finally {
            await client.exchange({ kind: 'flush', request: randomUUID() });
        }
    });
}
export async function finalizeRemoteResourceChecks(
    endpoint: ResourceCheckEndpoint,
    interval: ResourceCheckInterval
): Promise<ResourceCheckResponse> {
    return await resourceCheckClient(endpoint).exchange({ kind: 'finalize', request: randomUUID(), interval });
}
