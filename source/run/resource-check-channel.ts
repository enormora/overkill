import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { createInterface, type Interface } from 'node:readline';
import type { Socket } from 'node:net';
import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import { createJsonFrameLimiter } from '../json-frame-limiter.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import {
    resourceCheckIntervalSchema,
    resourceCheckOwnerSchema,
    resourceCheckSnapshotSchema
} from '../engine/assertion-result-schema.ts';

export const resourceCheckEndpointSchema = z.strictObject({ port: z.number().int().positive(), token: z.string() });
export type ResourceCheckEndpoint = Readonly<z.infer<typeof resourceCheckEndpointSchema>>;
const frameSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('flush'), request: z.string() }),
    z.strictObject({ kind: z.literal('admit'), request: z.string(), interval: resourceCheckIntervalSchema }),
    z.strictObject({
        kind: z.literal('register'),
        owner: resourceCheckOwnerSchema,
        resource: z.string(),
        consumers: z.array(workIdSchema)
    }),
    z.strictObject({ kind: z.literal('checkpoint'), snapshot: resourceCheckSnapshotSchema }),
    z.strictObject({
        kind: z.literal('stop'),
        owner: resourceCheckOwnerSchema,
        interval: resourceCheckIntervalSchema,
        cause: z.unknown()
    }),
    z.strictObject({
        kind: z.literal('cancel'),
        work: workIdSchema,
        interval: resourceCheckIntervalSchema,
        cause: z.unknown()
    }),
    z.strictObject({ kind: z.literal('finalize'), request: z.string(), interval: resourceCheckIntervalSchema }),
    z.strictObject({
        kind: z.literal('finalize-owner'),
        request: z.string(),
        owner: resourceCheckOwnerSchema,
        interval: resourceCheckIntervalSchema
    }),
    z.strictObject({ kind: z.literal('finalized'), request: z.string(), errors: z.array(z.string()) }),
    z.strictObject({
        kind: z.literal('result'),
        request: z.string(),
        snapshots: z.array(resourceCheckSnapshotSchema),
        errors: z.array(z.string())
    })
]);
export type ResourceCheckFrame = ReadonlyDeep<z.infer<typeof frameSchema>>;
const envelopeSchema = z.strictObject({ token: z.string(), frame: frameSchema });
const frameByteLimit = 1_048_576;
const queuedByteLimit = 4_194_304;
function decodeFrame(line: string, token: string): ResourceCheckFrame {
    const envelope = envelopeSchema.parse(JSON.parse(line));
    if (envelope.token !== token) {
        throw new Error('Resource observation token mismatch.');
    }
    return envelope.frame;
}
type Receive = (frame: ResourceCheckFrame) => Promise<void> | void;
type PendingFrames = {
    readonly size: number;
    readonly set: (key: string, operation: Promise<void>) => void;
    readonly delete: (key: string) => boolean;
};
type FrameDelivery = { readonly socket: Socket; readonly receive: Receive; readonly pending: PendingFrames; };
const pendingFrameLimit = 1024;
async function deliverFrame(delivery: FrameDelivery, frame: ResourceCheckFrame, key: string): Promise<void> {
    try {
        await delivery.receive(frame);
    } catch {
        delivery.socket.destroy();
    } finally {
        delivery.pending.delete(key);
    }
}
function enqueueFrame(delivery: FrameDelivery, line: string, token: string): void {
    if (delivery.pending.size >= pendingFrameLimit) {
        throw new Error('Resource observation queue exceeded its limit.');
    }
    const frame = decodeFrame(line, token);
    const key = randomUUID();
    delivery.pending.set(key, deliverFrame(delivery, frame, key));
}
function observeFrames(socket: Socket, lines: Interface, token: string, receive: Receive): void {
    const delivery: FrameDelivery = { socket, receive, pending: new Map() };
    lines.on('line', function receiveFrame(line) {
        try {
            enqueueFrame(delivery, line, token);
        } catch {
            socket.destroy();
        }
    });
}
export function resourceCheckChannel(
    socket: Socket,
    token: string,
    receive: Receive
): (frame: ResourceCheckFrame) => void {
    const limiter = new Transform({ transform: createJsonFrameLimiter(frameByteLimit, 'Resource check') });
    const lines = createInterface({ input: socket.pipe(limiter), crlfDelay: Number.POSITIVE_INFINITY });
    limiter.on('error', function closeInvalidFrames() {
        socket.destroy();
    });
    socket.on('error', function closeFailedChannel() {
        socket.destroy();
    });
    lines.on('error', function closeInvalidLines() {
        socket.destroy();
    });
    socket.once('close', function closeLines() {
        lines.close();
        limiter.destroy();
    });
    observeFrames(socket, lines, token, receive);
    return function send(frame) {
        const line = `${JSON.stringify({ token, frame })}\n`;
        if (socket.destroyed || Buffer.byteLength(line) > frameByteLimit || socket.writableLength > queuedByteLimit) {
            socket.destroy();
            return;
        }
        socket.write(line);
    };
}
