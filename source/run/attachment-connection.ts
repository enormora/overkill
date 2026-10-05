import { connect, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import {
    attachmentMaxFrameBytes,
    attachmentMaxPendingRequests,
    type AttachmentEndpoint,
    type AttachmentExchange,
    type AttachmentOperation,
    type AttachmentResponse
} from './attachment-protocol.ts';
import { attachmentReplySchema } from './attachment-wire-schema.ts';
import { boundedAttachmentFrames } from './attachment-frames.ts';

export type AttachmentConnection = {
    readonly ready: Promise<void>;
    readonly exchange: AttachmentExchange;
    readonly close: () => void;
    readonly observeDisconnect: (observer: () => void) => void;
};
const jsonEscapeExpansion = 6;
type PendingAttachmentReply = ReturnType<typeof Promise.withResolvers<AttachmentResponse>>;
type AttachmentChannelState = {
    readonly endpoint: AttachmentEndpoint;
    readonly socket: Socket;
    readonly pending: PendingAttachmentRequests;
    readonly sequence: StoredRunValue<number>;
    readonly failure: StoredRunValue<Error | null>;
    readonly ready: Promise<void>;
};
function attachmentChannelFail(state: AttachmentChannelState, error: Error): void {
    const { failure, pending } = state;

    failure.write(error);
    for (const request of pending.values()) {
        request.reject(error);
    }
    pending.clear();
}
function attachmentChannelReply(state: AttachmentChannelState, line: string): void {
    const { pending, socket } = state;

    const value: unknown = JSON.parse(line);
    const reply = attachmentReplySchema.parse(value);
    pending.get(reply.request)?.resolve(reply.result);
    pending.delete(reply.request);
    if (pending.size === 0) {
        socket.unref();
    }
}
function attachmentChannelReceive(state: AttachmentChannelState, line: string): void {
    const { socket } = state;

    try {
        attachmentChannelReply(state, line);
    } catch (error: unknown) {
        attachmentChannelFail(state, error instanceof Error ? error : new Error('Invalid attachment reply.'));
        socket.destroy();
    }
}
function attachmentChannelObserve(state: AttachmentChannelState): void {
    const { endpoint, socket } = state;

    const frames = boundedAttachmentFrames(
        endpoint.limits.maxInlineBytes * jsonEscapeExpansion + attachmentMaxFrameBytes
    );
    const lines = createInterface({ input: socket.pipe(frames), crlfDelay: Number.POSITIVE_INFINITY });
    frames.on('error', function (error: Error) {
        attachmentChannelFail(state, error);
        socket.destroy();
    });
    socket.on('error', function (error: Error) {
        attachmentChannelFail(state, error);
    });
    socket.on('close', function () {
        attachmentChannelFail(state, new Error('Attachment execution boundary disconnected.'));
        lines.close();
    });
    lines.on('line', function (line) {
        attachmentChannelReceive(state, line);
    });
}
function attachmentChannelClose(state: AttachmentChannelState): void {
    const { socket } = state;

    socket.end();
}
async function sendAttachmentRequest(
    state: AttachmentChannelState,
    operation: AttachmentOperation
): Promise<AttachmentResponse> {
    const { sequence, pending, socket, endpoint } = state;
    if (pending.size >= attachmentMaxPendingRequests) {
        throw new Error('Attachment transport request limit exceeded.');
    }
    const request = sequence.read();
    sequence.write(request + 1);
    const response = Promise.withResolvers<AttachmentResponse>();
    pending.set(request, response);
    socket.ref();
    socket.write(`${JSON.stringify({ request, token: endpoint.token, operation })}\n`);
    return response.promise;
}
async function attachmentChannelExchange(
    state: AttachmentChannelState,
    operation: AttachmentOperation
): Promise<AttachmentResponse> {
    await state.ready;
    const unavailable = state.failure.read();
    if (unavailable !== null) {
        throw unavailable;
    }
    return await sendAttachmentRequest(state, operation);
}
function observeAttachmentDisconnect(state: AttachmentChannelState, observer: () => void): void {
    state.socket.once('close', observer);
}
export function createAttachmentConnection(endpoint: AttachmentEndpoint): AttachmentConnection {
    const socket: Socket = connect({ host: '127.0.0.1', port: endpoint.port });
    const pending = new Map<number, PendingAttachmentReply>();
    const sequence = createStoredRunValue<number>(0);
    const failure = createStoredRunValue<Error | null>(null);
    const ready: Promise<void> = new Promise<void>(function (resolve, reject) {
        socket.once('connect', function () {
            socket.unref();
            resolve();
        });
        socket.once('error', reject);
    });
    const state: AttachmentChannelState = { endpoint, socket, pending, sequence, failure, ready };
    attachmentChannelObserve(state);
    return {
        ready: state.ready,
        observeDisconnect: observeAttachmentDisconnect.bind(null, state),
        close: attachmentChannelClose.bind(null, state),
        exchange: attachmentChannelExchange.bind(null, state)
    };
}

type PendingAttachmentRequests = {
    readonly size: number;
    readonly get: (request: number) => PendingAttachmentReply | undefined;
    readonly set: (request: number, reply: PendingAttachmentReply) => void;
    readonly delete: (request: number) => boolean;
    readonly clear: () => void;
    readonly values: () => Iterable<PendingAttachmentReply>;
};
