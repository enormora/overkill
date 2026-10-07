import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AttachmentLimits, RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import {
    attachmentScopeKey,
    type AttachmentOperation,
    type AttachmentOwner,
    type AttachmentResponse,
    type AttachmentCloseReason
} from './attachment-protocol.ts';
import type { AttachmentRetention } from './attachment-retention.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';

type OpenOperation = Extract<AttachmentOperation, { readonly kind: 'open' | 'prepare'; }>;
export type AttachmentScopeBudget = {
    readonly reserve: (limits: AttachmentLimits) => void;
    readonly available: (limits: AttachmentLimits) => number;
    readonly retained: (bytes: number) => void;
    readonly release: (bytes: number) => void;
};
export function createAttachmentScopeBudget(): AttachmentScopeBudget {
    const bytes = createStoredRunValue<number>(0);
    const count = createStoredRunValue<number>(0);
    function reserve(limits: AttachmentLimits): void {
        if (count.read() >= limits.maxScopeAttachments) {
            throw new Error('Attachment count limit exceeded.');
        }
        count.write(count.read() + 1);
    }
    function available(limits: AttachmentLimits): number {
        return limits.maxScopeBytes - bytes.read();
    }
    function retained(retainedBytes: number): void {
        bytes.write(bytes.read() + retainedBytes);
    }

    return {
        reserve,
        available,
        retained,
        release(releasedBytes) {
            bytes.write(Math.max(0, bytes.read() - releasedBytes));
            count.write(Math.max(0, count.read() - 1));
        }
    };
}
export type StoredAttachment = {
    readonly release: () => void;
    readonly channel: string;
    readonly branch: string | null;
    readonly owner: AttachmentOwner;
    readonly artifact: () => RuntimeAttachmentArtifact;
    readonly close: (reason: AttachmentCloseReason) => Promise<void>;
    readonly interrupt: (reason: 'interrupted' | 'unclosed') => Promise<AttachmentOwner | null>;
    readonly omit: () => void;
    readonly write: (data: string, limits: AttachmentLimits) => Promise<AttachmentResponse>;
};
type StoredAttachmentState = {
    readonly channel: string;
    readonly operation: OpenOperation;
    readonly initial: RuntimeAttachmentArtifact;
    readonly retention: AttachmentRetention;
    readonly budget: AttachmentScopeBudget;
    readonly branch: string | null;
    readonly owner: AttachmentOwner;
    readonly closed: StoredRunValue<boolean>;
    readonly failed: StoredRunValue<boolean>;
    readonly charged: StoredRunValue<number>;
};
function storedAttachmentArtifact(state: StoredAttachmentState): RuntimeAttachmentArtifact {
    const { initial, retention } = state;

    return { ...state.initial, payload: { ...initial.payload, content: retention.content() } };
}
async function storedAttachmentClose(state: StoredAttachmentState, reason: AttachmentCloseReason): Promise<void> {
    const { closed, retention } = state;

    if (closed.read()) {
        return;
    }
    closed.write(true);
    await retention.finish(reason === 'complete' ? { kind: 'complete' } : { kind: 'incomplete', reason });
}
async function storedAttachmentInterrupt(
    state: StoredAttachmentState,
    reason: 'interrupted' | 'unclosed'
): Promise<AttachmentOwner | null> {
    const { closed, retention, failed } = state;

    if (closed.read()) {
        return null;
    }
    closed.write(true);
    await retention.finish({ kind: 'incomplete', reason });
    return failed.read() ? null : state.owner;
}
function storedAttachmentAssertOpen(state: StoredAttachmentState): void {
    const { closed, failed } = state;

    if (closed.read() || failed.read()) {
        throw new Error('Attachment writer is closed.');
    }
}
function storedAttachmentOmit(state: StoredAttachmentState): void {
    const { retention } = state;

    storedAttachmentAssertOpen(state);
    retention.omit();
}
async function storedAttachmentRetain(
    state: StoredAttachmentState,
    bytes: Uint8Array,
    limits: AttachmentLimits
): Promise<number> {
    const { retention, budget, failed } = state;

    try {
        return await retention.retain(bytes, budget.available(limits));
    } catch (error: unknown) {
        failed.write(true);
        await storedAttachmentClose(state, 'write-error');
        throw error;
    }
}
function retainChargedBytes(state: StoredAttachmentState, retained: number): void {
    state.budget.retained(retained);
    state.charged.write(state.charged.read() + retained);
}
async function storedAttachmentWrite(
    state: StoredAttachmentState,
    data: string,
    limits: AttachmentLimits
): Promise<AttachmentResponse> {
    const { initial, failed, retention } = state;

    storedAttachmentAssertOpen(state);
    const bytes = Buffer.from(data, 'base64');
    const retained = await storedAttachmentRetain(state, bytes, limits);
    retainChargedBytes(state, retained);
    if (retained < bytes.length && initial.payload.content.kind === 'file') {
        failed.write(true);
        await retention.finish({ kind: 'incomplete', reason: 'byte-limit' });
        return { kind: 'error', message: 'Binary attachment byte limit exceeded.', reason: 'byte-limit' };
    }
    return { kind: 'written' };
}
type StoredAttachmentContent = {
    readonly initial: RuntimeAttachmentArtifact;
    readonly retention: AttachmentRetention;
    readonly budget: AttachmentScopeBudget;
};
export function createStoredAttachment(
    channel: string,
    operation: OpenOperation,
    content: StoredAttachmentContent
): StoredAttachment {
    const { initial, retention, budget } = content;
    const branch: string | null = operation.branch;
    const owner: AttachmentOwner = operation.owner;
    const closed = createStoredRunValue<boolean>(false);
    const failed = createStoredRunValue<boolean>(false);
    const state: StoredAttachmentState = {
        channel,
        operation,
        initial,
        retention,
        budget,
        branch,
        owner,
        closed,
        failed,
        charged: createStoredRunValue<number>(0)
    };
    return {
        release() {
            budget.release(state.charged.read());
        },
        channel: state.channel,
        branch: state.branch,
        owner: state.owner,
        artifact: storedAttachmentArtifact.bind(null, state),
        close: storedAttachmentClose.bind(null, state),
        interrupt: storedAttachmentInterrupt.bind(null, state),
        omit: storedAttachmentOmit.bind(null, state),
        write: storedAttachmentWrite.bind(null, state)
    };
}

type AttachmentStorageLocation = { readonly directory: string; readonly witnessDirectory: string; };
export function retainedAttachmentPath(
    options: AttachmentStorageLocation,
    operation: OpenOperation,
    writer: number
): string {
    const folder = createHash('sha256').update(attachmentScopeKey(operation.owner)).digest('hex');
    return operation.kind === 'prepare' && operation.subtype === 'witness'
        ? path.join(
            options.witnessDirectory,
            folder,
            operation.owner.kind === 'case' ? `attempt-${operation.owner.attempt.index}` : 'run',
            `${writer}.witness.json`
        )
        : path.join(options.directory, folder, `${writer}.attachment.bin`);
}
