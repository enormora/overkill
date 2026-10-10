import { mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AttachmentCompletion, AttachmentContent } from '../engine/runtime-attachment.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';

export type AttachmentRetention = {
    readonly content: () => AttachmentContent;
    readonly retain: (chunk: Uint8Array, availableBytes: number) => Promise<number>;
    readonly omit: () => void;
    readonly finish: (completion: AttachmentCompletion) => Promise<void>;
};
type AttachmentByteBudget = {
    readonly bytes: StoredRunValue<number>;
    readonly exceeded: StoredRunValue<boolean>;
    readonly reserve: (length: number, available: number) => number;
    readonly retained: (bytes: number) => void;
};
function createAttachmentByteBudget(limit: number): AttachmentByteBudget {
    const bytes = createStoredRunValue<number>(0);
    const exceeded = createStoredRunValue<boolean>(false);
    function reserve(length: number, available: number): number {
        const retainedLength = Math.max(0, Math.min(length, available, limit - bytes.read()));
        exceeded.write(exceeded.read() || retainedLength < length);
        return retainedLength;
    }
    function retained(retainedBytes: number): void {
        bytes.write(bytes.read() + retainedBytes);
    }

    return { bytes, exceeded, reserve, retained };
}
type InlineAttachmentRetention = {
    readonly omit: () => void;
    readonly content: () => AttachmentContent;
    readonly finish: (completion: AttachmentCompletion) => Promise<void>;
    readonly retain: (chunk: Uint8Array, availableBytes: number) => Promise<number>;
};
type InlineAttachmentRetentionState = {
    readonly kind: 'json' | 'text';
    readonly limit: number;
    readonly chunks: AttachmentTextChunks;
    readonly decoder: TextDecoder;
    readonly budget: AttachmentByteBudget;
    readonly completion: StoredRunValue<AttachmentCompletion>;
    readonly ended: StoredRunValue<boolean>;
};
function inlineAttachmentRetentionOmit(state: InlineAttachmentRetentionState): void {
    const { budget } = state;

    budget.exceeded.write(true);
}
function inlineAttachmentRetentionJson(state: InlineAttachmentRetentionState, text: string): AttachmentContent {
    const { ended, budget, completion } = state;

    if (!ended.read() || budget.exceeded.read() || completion.read().kind !== 'complete') {
        return { kind: 'omitted', limit: state.limit, reason: 'byte-limit' };
    }
    const value: unknown = JSON.parse(text);
    const snapshot = snapshotJson(value, state.limit);
    return snapshot === null
        ? { kind: 'omitted', limit: state.limit, reason: 'byte-limit' }
        : { byteLength: budget.bytes.read(), kind: 'json', value: snapshot.value };
}
function inlineAttachmentRetentionContent(state: InlineAttachmentRetentionState): AttachmentContent {
    const { chunks, completion } = state;

    const text = chunks.join('');
    return state.kind === 'json'
        ? inlineAttachmentRetentionJson(state, text)
        : { byteLength: Buffer.byteLength(text), completion: completion.read(), kind: 'text', text };
}
async function inlineAttachmentRetentionFinish(
    state: InlineAttachmentRetentionState,
    requestedCompletion: AttachmentCompletion
): Promise<void> {
    const { ended, completion, budget, chunks, decoder } = state;

    if (ended.read()) {
        return;
    }
    ended.write(true);
    completion.write(
        budget.exceeded.read() && requestedCompletion.kind === 'complete'
            ? { kind: 'truncated', reason: 'byte-limit' }
            : requestedCompletion
    );
    if (!budget.exceeded.read()) {
        try {
            chunks.push(decoder.decode(new Uint8Array(), { stream: false }));
        } catch (error: unknown) {
            completion.write({ kind: 'incomplete', reason: 'write-error' });
            throw error;
        }
    }
}
async function inlineAttachmentRetentionRetain(
    state: InlineAttachmentRetentionState,
    chunk: Uint8Array,
    availableBytes: number
): Promise<number> {
    const { budget, chunks, decoder } = state;

    const length = budget.reserve(chunk.byteLength, availableBytes);
    if (length > 0) {
        try {
            chunks.push(decoder.decode(chunk.subarray(0, length), { stream: true }));
        } catch (error: unknown) {
            state.completion.write({ kind: 'incomplete', reason: 'write-error' });
            state.ended.write(true);
            throw error;
        }
    }
    budget.retained(length);
    return length;
}
function createInlineAttachmentRetention(kind: 'json' | 'text', limit: number): InlineAttachmentRetention {
    const chunks: string[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const budget: AttachmentByteBudget = createAttachmentByteBudget(limit);
    const completion = createStoredRunValue<AttachmentCompletion>({ kind: 'incomplete', reason: 'unclosed' });
    const ended = createStoredRunValue<boolean>(false);
    const state: InlineAttachmentRetentionState = { kind, limit, chunks, decoder, budget, completion, ended };
    return {
        omit: inlineAttachmentRetentionOmit.bind(null, state),
        content: inlineAttachmentRetentionContent.bind(null, state),
        finish: inlineAttachmentRetentionFinish.bind(null, state),
        retain: inlineAttachmentRetentionRetain.bind(null, state)
    };
}
type FileAttachmentRetention = {
    readonly omit: () => void;
    readonly content: () => AttachmentContent;
    readonly finish: (completion: AttachmentCompletion) => Promise<void>;
    readonly retain: (chunk: Uint8Array, availableBytes: number) => Promise<number>;
};
type FileAttachmentRetentionState = {
    readonly file: FileHandle;
    readonly filePath: string;
    readonly limit: number;
    readonly budget: AttachmentByteBudget;
    readonly completion: StoredRunValue<
        { readonly kind: 'complete'; } | {
            readonly kind: 'incomplete';
            readonly reason: 'byte-limit' | 'capture-limit' | 'interrupted' | 'unclosed' | 'write-error';
        }
    >;
    readonly ended: StoredRunValue<boolean>;
};
function fileAttachmentRetentionOmit(): void {
    throw new TypeError('Binary attachments cannot be omitted as JSON.');
}
function fileAttachmentRetentionContent(state: FileAttachmentRetentionState): AttachmentContent {
    const { budget, completion } = state;

    return { byteLength: budget.bytes.read(), completion: completion.read(), kind: 'file', path: state.filePath };
}
async function fileAttachmentRetentionFinish(
    state: FileAttachmentRetentionState,
    requestedCompletion: AttachmentCompletion
): Promise<void> {
    const { ended, completion, budget, file } = state;

    if (ended.read()) {
        return;
    }
    ended.write(true);
    completion.write(
        budget.exceeded.read() || requestedCompletion.kind === 'truncated'
            ? { kind: 'incomplete', reason: 'byte-limit' }
            : requestedCompletion
    );
    await file.close();
}
async function fileAttachmentRetentionWrite(state: FileAttachmentRetentionState, chunk: Uint8Array): Promise<void> {
    const { file, budget } = state;

    let offset = 0;
    while (offset < chunk.byteLength) {
        const result = await file.write(chunk.subarray(offset));
        if (result.bytesWritten === 0) {
            throw new Error('Attachment file write made no progress.');
        }
        offset += result.bytesWritten;
        budget.retained(result.bytesWritten);
    }
}
async function fileAttachmentRetentionRetain(
    state: FileAttachmentRetentionState,
    chunk: Uint8Array,
    availableBytes: number
): Promise<number> {
    const { budget } = state;

    const length = budget.reserve(chunk.byteLength, availableBytes);
    try {
        await fileAttachmentRetentionWrite(state, chunk.subarray(0, length));
    } catch (error: unknown) {
        await fileAttachmentRetentionFinish(state, { kind: 'incomplete', reason: 'write-error' });
        throw error;
    }
    return length;
}
function createFileAttachmentRetention(file: FileHandle, filePath: string, limit: number): FileAttachmentRetention {
    const budget: AttachmentByteBudget = createAttachmentByteBudget(limit);
    const completion = createStoredRunValue<Exclude<AttachmentCompletion, { readonly kind: 'truncated'; }>>({
        kind: 'incomplete',
        reason: 'unclosed'
    });
    const ended = createStoredRunValue<boolean>(false);
    const state: FileAttachmentRetentionState = { file, filePath, limit, budget, completion, ended };
    return {
        omit: fileAttachmentRetentionOmit,
        content: fileAttachmentRetentionContent.bind(null, state),
        finish: fileAttachmentRetentionFinish.bind(null, state),
        retain: fileAttachmentRetentionRetain.bind(null, state)
    };
}
export async function createAttachmentRetention(
    kind: 'binary' | 'json' | 'text',
    projectRoot: string,
    filePath: string,
    limit: number
): Promise<AttachmentRetention> {
    if (kind !== 'binary') {
        return createInlineAttachmentRetention(kind, limit);
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    return createFileAttachmentRetention(
        await open(filePath, 'wx'),
        path.relative(projectRoot, filePath).split(path.sep).join('/'),
        limit
    );
}

type AttachmentTextChunks = { readonly push: (chunk: string) => number; readonly join: (separator: string) => string; };
