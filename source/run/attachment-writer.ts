import { createReadStream } from 'node:fs';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import {
    attachmentChunkBytes,
    type AttachmentCloseReason,
    type AttachmentOperation,
    type AttachmentOwner,
    type AttachmentResponse
} from './attachment-protocol.ts';

export type AttachmentOperations = {
    readonly owner: AttachmentOwner;
    readonly send: (operation: AttachmentOperation) => Promise<AttachmentResponse>;
    readonly fail: (message: string, reason: string) => Error;
    readonly verify: () => void;
    readonly release: () => void;
};

export type AttachmentStream = {
    readonly owner: AttachmentOwner;
    readonly write: (chunk: Uint8Array | string) => Promise<void>;
    readonly omit: () => Promise<void>;
    readonly finish: (reason: AttachmentCloseReason) => Promise<RuntimeAttachmentArtifact>;
    readonly close: () => Promise<RuntimeAttachmentArtifact>;
};
type AttachmentStreamState = {
    readonly operations: AttachmentOperations;
    readonly writer: number;
    readonly kind: 'binary' | 'json' | 'text';
    readonly owner: AttachmentOwner;
    readonly pending: StoredRunValue<Promise<void> | null>;
    readonly closing: StoredRunValue<Promise<RuntimeAttachmentArtifact> | null>;
    readonly failure: StoredRunValue<Error | null>;
};
function assertWritableAttachmentStream(state: AttachmentStreamState): void {
    const { operations, closing, pending, failure } = state;
    operations.verify();
    if (closing.read() !== null || pending.read() !== null) {
        throw operations.fail(
            'Attachment writes require an open writer and an awaited previous write.',
            'writer-state'
        );
    }
    const previousFailure = failure.read();
    if (previousFailure !== null) {
        throw previousFailure;
    }
}
function attachmentStreamValidateWrite(state: AttachmentStreamState, chunk: Uint8Array | string): Uint8Array {
    assertWritableAttachmentStream(state);
    if (state.kind === 'binary' && typeof chunk === 'string') {
        throw state.operations.fail('Binary attachment writers require bytes.', 'invalid-chunk');
    }
    return typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
}
async function attachmentStreamWriteChunks(state: AttachmentStreamState, bytes: Uint8Array): Promise<void> {
    const { operations } = state;

    for (let offset = 0; offset < bytes.byteLength; offset += attachmentChunkBytes) {
        await operations.send({
            data: Buffer.from(bytes.subarray(offset, offset + attachmentChunkBytes)).toString('base64'),
            kind: 'write',
            writer: state.writer
        });
    }
}
async function attachmentStreamWrite(state: AttachmentStreamState, chunk: Uint8Array | string): Promise<void> {
    const { pending, failure, operations } = state;

    pending.write(attachmentStreamWriteChunks(state, attachmentStreamValidateWrite(state, chunk)));
    try {
        await pending.read();
    } catch (error: unknown) {
        const writeError = error instanceof Error ? error : operations.fail('Attachment write failed.', 'write-error');
        failure.write(writeError);
        throw writeError;
    } finally {
        pending.write(null);
    }
}
async function attachmentStreamOmit(state: AttachmentStreamState): Promise<void> {
    const { operations } = state;

    await operations.send({ kind: 'omit', writer: state.writer });
}
async function attachmentStreamSettleWrite(state: AttachmentStreamState): Promise<void> {
    const { pending } = state;

    try {
        await pending.read();
    } catch {
    }
}
async function attachmentStreamCloseOnce(
    state: AttachmentStreamState,
    reason: AttachmentCloseReason
): Promise<RuntimeAttachmentArtifact> {
    const { operations, failure } = state;

    await attachmentStreamSettleWrite(state);
    const completion = failure.read() !== null && reason === 'complete' ? 'write-error' : reason;
    const response = await operations.send({ kind: 'close', reason: completion, writer: state.writer });
    operations.release();
    if (response.kind !== 'closed') {
        throw operations.fail('Attachment close returned an invalid reply.', 'protocol');
    }
    if (reason === 'unclosed' && failure.read() === null) {
        operations.fail('Attachment writer was not closed.', 'unclosed');
    }
    return response.artifact;
}
async function attachmentStreamFinish(
    state: AttachmentStreamState,
    reason: AttachmentCloseReason
): Promise<RuntimeAttachmentArtifact> {
    const { closing } = state;

    closing.write(closing.read() ?? attachmentStreamCloseOnce(state, reason));
    const result = closing.read();
    if (result === null) {
        throw new Error('Attachment writer did not start closing.');
    }
    return await result;
}
async function attachmentStreamClose(state: AttachmentStreamState): Promise<RuntimeAttachmentArtifact> {
    const { closing, operations, failure } = state;

    if (closing.read() === null) {
        operations.verify();
    }
    const artifact = await attachmentStreamFinish(state, 'complete');
    const previousFailure = failure.read();
    if (previousFailure !== null) {
        throw previousFailure;
    }
    return artifact;
}
export function createAttachmentStream(
    operations: AttachmentOperations,
    writer: number,
    kind: 'binary' | 'json' | 'text'
): AttachmentStream {
    const owner: AttachmentOwner = operations.owner;
    const pending = createStoredRunValue<Promise<void> | null>(null);
    const closing = createStoredRunValue<Promise<RuntimeAttachmentArtifact> | null>(null);
    const failure = createStoredRunValue<Error | null>(null);
    const state: AttachmentStreamState = { operations, writer, kind, owner, pending, closing, failure };
    return {
        owner: state.owner,
        write: attachmentStreamWrite.bind(null, state),
        omit: attachmentStreamOmit.bind(null, state),
        finish: attachmentStreamFinish.bind(null, state),
        close: attachmentStreamClose.bind(null, state)
    };
}

export async function copyAttachmentFile(writer: AttachmentStream, filePath: string): Promise<void> {
    const chunks = createReadStream(filePath, { highWaterMark: attachmentChunkBytes });
    for await (const chunk of chunks) {
        if (!(chunk instanceof Uint8Array)) {
            throw new TypeError('Attachment file reader did not return bytes.');
        }
        await writer.write(chunk);
    }
}
