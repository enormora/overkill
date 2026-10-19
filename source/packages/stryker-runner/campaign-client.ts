import { connect, type Socket } from 'node:net';
import type { InvocationBudget } from '../run/run.entry-point.ts';
import {
    campaignEndpointSchema,
    campaignResponseSchema,
    campaignProtocolVersion,
    type CampaignEndpoint,
    type CampaignRequest,
    type CampaignResponse
} from './campaign-protocol.ts';
import { receiveCampaignFrames, sendCampaignFrame } from './campaign-transport.ts';

export type CampaignClient = {
    readonly request: (request: CampaignRequest, budget: InvocationBudget | null) => Promise<CampaignResponse>;
    readonly dispose: () => void;
    readonly expireRequests: () => Promise<void>;
};
type PendingRequest = Readonly<PromiseWithResolvers<CampaignResponse>>;
type CampaignConnection = {
    readonly socket: Socket;
    readonly requests: Readonly<Map<number, PendingRequest>>;
    readonly endpoint: CampaignEndpoint;
};

function observeConnection(connection: CampaignConnection, signal: AbortSignal): void {
    const { socket, requests } = connection;
    socket.on('error', function () {
        socket.destroy();
    });
    socket.once('close', function () {
        for (const request of requests.values()) {
            request.reject(new Error('Campaign IPC disconnected.'));
        }
        requests.clear();
    });
    signal.addEventListener('abort', function () {
        socket.destroy();
    }, { once: true });
    receiveCampaignFrames(socket, function (message) {
        const frame = campaignResponseSchema.parse(message);
        const pending = requests.get(frame.id);
        if (pending === undefined) {
            throw new Error('Campaign IPC replied to an unknown request.');
        }
        requests.delete(frame.id);
        pending.resolve(frame.response);
        if (requests.size === 0) {
            socket.unref();
        }
    });
}
async function awaitConnection(socket: Socket): Promise<void> {
    await new Promise<void>(function (resolve, reject) {
        socket.once('connect', resolve);
        socket.once('error', reject);
        socket.once('close', function () {
            reject(new Error('Campaign IPC closed during registration.'));
        });
    });
    socket.unref();
}
type RequestCancellation = {
    readonly connection: CampaignConnection;
    readonly id: number;
    readonly sent: Promise<void>;
    readonly budget: InvocationBudget | null;
};
async function sendCancellation(input: RequestCancellation): Promise<void> {
    const frame = {
        kind: 'cancel' as const,
        version: campaignProtocolVersion,
        token: input.connection.endpoint.token,
        cancel: input.id,
        reason: input.budget?.expired() === true ? 'deadline' : 'cancelled'
    };
    try {
        await input.sent;
        await sendCampaignFrame(input.connection.socket, frame);
    } catch {
        input.connection.socket.destroy();
    }
}
function observeRequestCancellation(input: RequestCancellation): () => Promise<void> {
    const observation = new AbortController();
    const deliveries = new Set<Promise<void>>();
    function cancelRequest(): void {
        deliveries.add(sendCancellation(input));
    }
    input.budget?.signal.addEventListener('abort', cancelRequest, { once: true, signal: observation.signal });
    if (input.budget?.signal.aborted === true) {
        cancelRequest();
    }
    return async function stopCancellation() {
        observation.abort();
        await Promise.all(deliveries);
    };
}
type RequestDelivery = {
    readonly connection: CampaignConnection;
    readonly id: number;
    readonly request: CampaignRequest;
    readonly budget: InvocationBudget | null;
};
async function exchangeRequest(input: RequestDelivery): Promise<CampaignResponse> {
    const { connection, id, request, budget } = input;
    const response = Promise.withResolvers<CampaignResponse>();
    connection.requests.set(id, response);
    const sent = sendCampaignFrame(connection.socket, {
        kind: 'request',
        version: campaignProtocolVersion,
        token: connection.endpoint.token,
        id,
        request,
        timeoutMilliseconds: budget?.remainingMilliseconds() ?? null
    });
    const stop = observeRequestCancellation({ connection, id, sent, budget });
    try {
        const replies = await Promise.all([ sent, response.promise ]);
        return replies[1];
    } finally {
        await stop();
    }
}
async function expireConnectionRequests(connection: CampaignConnection): Promise<void> {
    const pending = Array.from(connection.requests.entries());
    try {
        await Promise.all(pending.map(async function expireRequest([ id, request ]) {
            await sendCampaignFrame(connection.socket, {
                kind: 'cancel',
                version: campaignProtocolVersion,
                token: connection.endpoint.token,
                cancel: id,
                reason: 'deadline'
            });
            await request.promise;
        }));
    } catch (error: unknown) {
        connection.socket.destroy();
        throw error;
    }
}
async function deliverRequest(input: RequestDelivery): Promise<CampaignResponse> {
    if (input.connection.socket.destroyed) {
        throw new Error('Campaign IPC is unavailable.');
    }
    input.connection.socket.ref();
    try {
        return await exchangeRequest(input);
    } catch (error: unknown) {
        input.connection.socket.destroy();
        throw error;
    }
}
function admittedReply(reply: CampaignResponse): CampaignResponse {
    if (reply.kind === 'error') {
        throw new Error(reply.message);
    }
    return reply;
}
export async function connectCampaign(endpoint: CampaignEndpoint, signal: AbortSignal): Promise<CampaignClient> {
    const settings = campaignEndpointSchema.parse(endpoint);
    signal.throwIfAborted();
    const connection: CampaignConnection = {
        socket: connect({ host: '127.0.0.1', port: settings.port }),
        requests: new Map(),
        endpoint: settings
    };
    const identifiers = { next: 0 };
    observeConnection(connection, signal);
    await awaitConnection(connection.socket);
    return {
        async expireRequests() {
            await expireConnectionRequests(connection);
        },
        async request(request, budget) {
            const id = identifiers.next;
            identifiers.next += 1;
            return admittedReply(await deliverRequest({ connection, id, request, budget }));
        },
        dispose() {
            connection.socket.destroy();
        }
    };
}
