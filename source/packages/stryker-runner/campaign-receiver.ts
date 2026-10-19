import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { createClock, type Clock } from '@enormora/clock';
import {
    createInvocationBudget,
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    type InvocationBudget
} from '../run/run.entry-point.ts';
import {
    campaignFrameSchema,
    type campaignRequestSchema,
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
    readonly signal: AbortSignal;
    readonly budget: InvocationBudget | null;
    readonly operations: Readonly<Map<number, AbortController>>;
};

const receiver = { pending: null as Promise<CampaignEndpoint> | null };

async function admittedResponse(
    worker: CampaignWorker,
    request: Parameters<CampaignWorker['respond']>[0],
    signal: AbortSignal,
    timeoutMilliseconds: number | null
): Promise<CampaignResponse> {
    try {
        signal.throwIfAborted();
        return await worker.respond(request, signal, timeoutMilliseconds);
    } catch (error: unknown) {
        if (signal.reason instanceof InvocationDeadlineExceededError && isInvocationCancellation(error, signal)) {
            return { kind: 'timeout', data: null };
        }
        return { kind: 'error', message: String(error) };
    }
}

async function workerResponse(
    worker: CampaignWorker,
    delivery: CampaignDelivery
): Promise<ReturnType<typeof campaignResponseSchema.parse>> {
    const { frame, signal, budget } = delivery;
    const response = budget?.expired() === true && !signal.aborted
        ? { kind: 'timeout' as const, data: null }
        : await admittedResponse(worker, frame.request, signal, budget?.remainingMilliseconds() ?? null);
    return campaignResponseSchema.parse({ version: campaignProtocolVersion, id: frame.id, response });
}

async function deliverFrame(delivery: CampaignDelivery): Promise<void> {
    await delivery.previous;
    try {
        await sendCampaignFrame(
            delivery.socket,
            await workerResponse(delivery.worker, delivery)
        );
    } catch {
        delivery.socket.destroy();
    } finally {
        delivery.budget?.dispose();
        delivery.operations.delete(delivery.frame.id);
    }
}

type CampaignAdmission = {
    readonly socket: Socket;
    readonly worker: CampaignWorker;
    readonly clock: Clock;
    readonly operations: Readonly<Map<number, AbortController>>;
};
function admitDelivery(
    admission: CampaignAdmission,
    frame: Readonly<ReturnType<typeof campaignRequestSchema.parse>>,
    previous: Promise<void>
): CampaignDelivery {
    if (admission.operations.has(frame.id)) {
        throw new Error('Duplicate campaign request identity.');
    }
    const controller = new AbortController();
    admission.operations.set(frame.id, controller);
    const budget = frame.timeoutMilliseconds === null
        ? null
        : createInvocationBudget(frame.timeoutMilliseconds, controller.signal, admission.clock);
    return { ...admission, frame, previous, budget, signal: budget?.signal ?? controller.signal };
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
    const clock = createClock();
    const operations = new Map<number, AbortController>();
    let pending = Promise.resolve();
    socket.on('error', function () {
        socket.destroy();
    });
    socket.once('close', function () {
        worker.cancel();
        for (const operation of operations.values()) {
            operation.abort();
        }
        pending = finishWorker(worker, pending);
    });
    receiveCampaignFrames(socket, function (message) {
        const frame = campaignFrameSchema.parse(message);
        if (frame.token !== token) {
            throw new Error('Campaign authentication failed.');
        }
        if (frame.kind === 'cancel') {
            operations.get(frame.cancel)?.abort(
                frame.reason === 'deadline' ? new InvocationDeadlineExceededError() : new Error('Invocation cancelled.')
            );
            return;
        }
        if (frame.request.kind === 'release') {
            worker.cancel();
        }
        pending = deliverFrame(admitDelivery({ socket, worker, clock, operations }, frame, pending));
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
