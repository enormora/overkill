import type { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { createInterface, type Interface } from 'node:readline';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import type { AttachmentStore } from './attachment-store.ts';
import {
    attachmentMaxFrameBytes,
    attachmentMaxPendingRequests,
    type AttachmentEndpoint,
    type AttachmentOwner
} from './attachment-protocol.ts';
import { attachmentRequestSchema } from './attachment-wire-schema.ts';
import { boundedAttachmentFrames } from './attachment-frames.ts';

export type AttachmentServer = {
    readonly endpoint: AttachmentEndpoint;
    readonly finish: () => Promise<readonly AttachmentOwner[]>;
};
type AttachmentServerChannels = {
    readonly accept: (socket: Socket) => void;
    readonly finish: (server: Server) => Promise<readonly AttachmentOwner[]>;
};
type AttachmentServerChannelsState = {
    readonly store: AttachmentStore;
    readonly token: string;
    readonly sockets: AttachmentSockets;
    readonly operations: AttachmentChannelOperations;
    readonly abandoned: AbandonedAttachments;
};
async function attachmentServerChannelsReply(
    state: AttachmentServerChannelsState,
    line: string,
    socket: Socket,
    channel: string
): Promise<void> {
    const { store } = state;

    const value: unknown = JSON.parse(line);
    const request = attachmentRequestSchema.parse(value);
    if (request.token !== state.token) {
        throw new Error('Invalid attachment execution token.');
    }
    const result = await store.exchange(channel, request.operation);
    await new Promise<void>(function acknowledgeAttachment(resolve, reject) {
        socket.write(`${JSON.stringify({ request: request.request, result })}\n`, function attachmentSent(error) {
            if (error === undefined || error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
type AttachmentChannelRequest = {
    readonly line: string;
    readonly socket: Socket;
    readonly channel: string;
    readonly previous: Promise<void>;
    readonly queued: StoredRunValue<number>;
};
async function attachmentServerChannelsRequest(
    state: AttachmentServerChannelsState,
    request: AttachmentChannelRequest
): Promise<void> {
    const { line, socket, channel, previous } = request;
    await previous;
    try {
        await attachmentServerChannelsReply(state, line, socket, channel);
    } catch {
        socket.destroy();
    } finally {
        request.queued.write(request.queued.read() - 1);
    }
}
async function attachmentServerChannelsInterrupt(
    state: AttachmentServerChannelsState,
    channel: string,
    previous: Promise<void>
): Promise<void> {
    const { abandoned, store } = state;

    await previous;
    abandoned.push(...await store.finish(channel));
}
function observeAttachmentChannelFailures(socket: Socket, frames: Transform, lines: Interface): void {
    frames.on('error', function () {
        socket.destroy();
    });
    lines.on('error', function () {
        socket.destroy();
    });
    socket.on('error', function () {
        socket.destroy();
    });
}
function attachmentServerChannelsAccept(state: AttachmentServerChannelsState, socket: Socket): void {
    const { sockets } = state;

    sockets.add(socket);
    const channel = randomUUID();
    const frames = boundedAttachmentFrames(attachmentMaxFrameBytes);
    const lines = createInterface({ input: socket.pipe(frames), crlfDelay: Number.POSITIVE_INFINITY });
    let queue = Promise.resolve();
    const queued = createStoredRunValue(0);
    observeAttachmentChannelFailures(socket, frames, lines);
    lines.on('line', function receiveAttachmentLine(line) {
        if (queued.read() >= attachmentMaxPendingRequests) {
            socket.destroy();
            return;
        }
        queued.write(queued.read() + 1);
        state.operations.delete(queue);
        queue = attachmentServerChannelsRequest(state, { line, socket, channel, previous: queue, queued });
        state.operations.add(queue);
    });
    socket.on('close', function attachmentChannelClosed() {
        sockets.delete(socket);
        lines.close();
        state.operations.delete(queue);
        const interrupted = attachmentServerChannelsInterrupt(state, channel, queue);
        state.operations.add(interrupted);
    });
}
async function attachmentServerChannelsFinish(
    state: AttachmentServerChannelsState,
    server: Server
): Promise<readonly AttachmentOwner[]> {
    const { store } = state;

    await Promise.all(state.operations.values());
    const owners = [ ...state.abandoned.values(), ...await store.finish(null) ];
    for (const socket of state.sockets.values()) {
        socket.destroy();
    }
    await new Promise<void>(function closeAttachmentServer(resolve, reject) {
        server.close(function attachmentServerClosed(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
    await Promise.all(state.operations.values());
    return owners;
}
function createAttachmentServerChannels(store: AttachmentStore, token: string): AttachmentServerChannels {
    const sockets = new Set<Socket>();
    const operations = new Set<Promise<unknown>>();
    const abandoned: AttachmentOwner[] = [];
    const state: AttachmentServerChannelsState = { store, token, sockets, operations, abandoned };
    return {
        accept: attachmentServerChannelsAccept.bind(null, state),
        finish: attachmentServerChannelsFinish.bind(null, state)
    };
}
export async function createAttachmentServer(
    store: AttachmentStore,
    limits: AttachmentLimits
): Promise<AttachmentServer> {
    const token = randomUUID();
    const channels = createAttachmentServerChannels(store, token);
    const server = createServer(function (socket) {
        channels.accept(socket);
    });
    await new Promise<void>(function listenForAttachments(resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Attachment server did not obtain an execution address.');
    }
    let finishing: Promise<readonly AttachmentOwner[]> | null = null;
    return {
        endpoint: { branch: null, limits, port: address.port, token },
        async finish() {
            finishing = finishing ?? channels.finish(server);
            return await finishing;
        }
    };
}

type AttachmentSockets = {
    readonly add: (socket: Socket) => void;
    readonly delete: (socket: Socket) => boolean;
    readonly values: () => Iterable<Socket>;
};
type AttachmentChannelOperations = {
    readonly add: (operation: Promise<unknown>) => void;
    readonly delete: (operation: Promise<unknown>) => boolean;
    readonly values: () => Iterable<Promise<unknown>>;
};
type AbandonedAttachments = {
    readonly push: (...owners: readonly AttachmentOwner[]) => number;
    readonly values: () => Iterable<AttachmentOwner>;
};
