import { connect, type Socket } from 'node:net';
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
    readonly request: (request: CampaignRequest) => Promise<CampaignResponse>;
    readonly dispose: () => void;
};
type PendingRequest = {
    readonly resolve: (response: CampaignResponse) => void;
    readonly reject: (error: Error) => void;
};
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
async function deliverRequest(
    connection: CampaignConnection,
    id: number,
    request: CampaignRequest
): Promise<CampaignResponse> {
    const { socket, requests, endpoint } = connection;
    if (socket.destroyed) {
        throw new Error('Campaign IPC is unavailable.');
    }
    socket.ref();
    const response = new Promise<CampaignResponse>(function (resolve, reject) {
        requests.set(id, { resolve, reject });
    });
    try {
        const replies = await Promise.all([
            sendCampaignFrame(socket, { version: campaignProtocolVersion, token: endpoint.token, id, request }),
            response
        ]);
        return replies[1];
    } catch (error: unknown) {
        socket.destroy();
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
        async request(request) {
            const id = identifiers.next;
            identifiers.next += 1;
            return admittedReply(await deliverRequest(connection, id, request));
        },
        dispose() {
            connection.socket.destroy();
        }
    };
}
