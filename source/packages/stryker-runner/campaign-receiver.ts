import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import {
    campaignRequestSchema,
    campaignResponseSchema,
    campaignProtocolVersion,
    type CampaignEndpoint,
    type CampaignResponse
} from './campaign-protocol.ts';
import { receiveCampaignFrames, sendCampaignFrame } from './campaign-transport.ts';
import { createCampaignWorker, type CampaignWorker } from './campaign-worker.ts';
import type { CampaignBaseline } from './mutation-catalog.ts';

type CampaignDelivery = {
    readonly socket: Socket;
    readonly worker: CampaignWorker;
    readonly frame: Readonly<ReturnType<typeof campaignRequestSchema.parse>>;
    readonly previous: Promise<void>;
};

const receiver = { pending: null as Promise<CampaignEndpoint> | null };

async function admittedResponse(
    worker: CampaignWorker,
    request: Parameters<CampaignWorker['respond']>[0]
): Promise<CampaignResponse> {
    try {
        return await worker.respond(request);
    } catch (error: unknown) {
        return { kind: 'error', message: String(error) };
    }
}

async function workerResponse(
    worker: CampaignWorker,
    frame: Readonly<ReturnType<typeof campaignRequestSchema.parse>>
): Promise<ReturnType<typeof campaignResponseSchema.parse>> {
    const response = await admittedResponse(worker, frame.request);
    return campaignResponseSchema.parse({ version: campaignProtocolVersion, id: frame.id, response });
}

async function deliverFrame(delivery: CampaignDelivery): Promise<void> {
    await delivery.previous;
    try {
        await sendCampaignFrame(
            delivery.socket,
            await workerResponse(delivery.worker, delivery.frame)
        );
    } catch {
        delivery.socket.destroy();
    }
}

async function finishWorker(worker: CampaignWorker, previous: Promise<void>): Promise<void> {
    await previous;
    try {
        await worker.dispose();
    } catch {}
}

function serveWorker(socket: Socket, token: string, baselines: Readonly<Map<string, CampaignBaseline>>): void {
    socket.unref();
    const worker = createCampaignWorker(baselines);
    let pending = Promise.resolve();
    socket.on('error', function () {
        socket.destroy();
    });
    socket.once('close', function () {
        worker.cancel();
        pending = finishWorker(worker, pending);
    });
    receiveCampaignFrames(socket, function (message) {
        const frame = campaignRequestSchema.parse(message);
        if (frame.token !== token) {
            throw new Error('Campaign authentication failed.');
        }
        if (frame.request.kind === 'release') {
            worker.cancel();
        }
        pending = deliverFrame({ socket, worker, frame, previous: pending });
    });
}

async function startReceiver(): Promise<CampaignEndpoint> {
    const token = randomUUID();
    const baselines = new Map<string, CampaignBaseline>();
    const server = createServer(function (socket) {
        serveWorker(socket, token, baselines);
    });
    await new Promise<void>(function (resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    server.unref();
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Campaign receiver has no TCP endpoint.');
    }
    return { port: address.port, token };
}

export async function campaignReceiver(): Promise<CampaignEndpoint> {
    receiver.pending = receiver.pending ?? startReceiver();
    return await receiver.pending;
}
