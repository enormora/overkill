import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import type { RuntimeAttachmentArtifact, AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import {
    attachmentMetadataBytes,
    type AttachmentOperation,
    type AttachmentOwner,
    type AttachmentResponse,
    type AttachmentCloseReason
} from './attachment-protocol.ts';
import { createAttachmentRetention, type AttachmentRetention } from './attachment-retention.ts';

type OpenOperation = Extract<AttachmentOperation, { readonly kind: 'open'; }>;
type AttachmentScopeBudget = {
    readonly reserve: (limits: AttachmentLimits) => void;
    readonly available: (limits: AttachmentLimits) => number;
    readonly retained: (bytes: number) => void;
};
function createAttachmentScopeBudget(): AttachmentScopeBudget {
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

    return { reserve, available, retained };
}
type StoredAttachment = {
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
async function storedAttachmentWrite(
    state: StoredAttachmentState,
    data: string,
    limits: AttachmentLimits
): Promise<AttachmentResponse> {
    const { budget, initial, failed, retention } = state;

    storedAttachmentAssertOpen(state);
    const bytes = Buffer.from(data, 'base64');
    const retained = await storedAttachmentRetain(state, bytes, limits);
    budget.retained(retained);
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
function createStoredAttachment(
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
        failed
    };
    return {
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
export type AttachmentStore = {
    readonly exchange: (channel: string, operation: AttachmentOperation) => Promise<AttachmentResponse>;
    readonly retainsBranch: (branch: string | null) => boolean;
    readonly registerBranch: (branch: string, retain: () => boolean) => void;
    readonly branchArtifacts: (branch: string | null) => readonly RuntimeAttachmentArtifact[];
    readonly selectedArtifacts: () => readonly RuntimeAttachmentArtifact[];
    readonly artifacts: () => readonly RuntimeAttachmentArtifact[];
    readonly prune: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
    readonly finish: (channel: string | null) => Promise<readonly AttachmentOwner[]>;
};
export type AttachmentStoreOptions = {
    readonly projectRoot: string;
    readonly directory: string;
    readonly limits: AttachmentLimits;
    readonly work: readonly WorkId[];
    readonly captureTime: () => number;
    readonly checkpoint: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
};
function ownerKey(owner: AttachmentOwner): string {
    return owner.kind === 'run' ? 'run' : workIdentityKey(owner.work);
}
function attachmentId(owner: AttachmentOwner, sequence: number): RuntimeAttachmentArtifact['id'] {
    if (owner.kind === 'run') {
        return { attempt: null, runtimes: [], scope: { kind: 'run' }, sequence, subtype: 'attachment', workload: null };
    }
    return {
        attempt: owner.attempt,
        runtimes: owner.work.runtimes,
        scope: { activeCases: [ owner.work.case ], case: owner.work.case, confidence: 'active-case', kind: 'case' },
        sequence,
        subtype: 'attachment',
        workload: owner.work.workload
    };
}
const firstPrintableCodePoint = 32;
const deleteCodePoint = 127;
function isControlCharacter(character: string): boolean {
    const code = character.codePointAt(0) ?? 0;
    return code < firstPrintableCodePoint || code === deleteCodePoint;
}
function validateMetadata(operation: OpenOperation): void {
    for (const value of [ operation.metadata.name, operation.metadata.mediaType ]) {
        if (
            value.length === 0 || Buffer.byteLength(value) > attachmentMetadataBytes ||
            Array.from(value).some(isControlCharacter)
        ) {
            throw new TypeError('Attachment names and media types require 1 to 256 bytes without control characters.');
        }
    }
}
type RunAttachmentStoreState = {
    readonly options: AttachmentStoreOptions;
    readonly writers: RetainedAttachmentRegistry;
    readonly branches: AttachmentBranchRegistry;
    readonly budgets: AttachmentBudgetRegistry;
    readonly planned: ReadonlySet<string>;
    readonly sequence: StoredRunValue<number>;
};
function runAttachmentStoreArtifacts(state: RunAttachmentStoreState): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array.from(writers.values(), function retainedArtifact(writer) {
        return writer.artifact();
    });
}
function runAttachmentStoreRegisterBranch(state: RunAttachmentStoreState, branch: string, retain: () => boolean): void {
    const { branches } = state;

    branches.set(branch, retain);
}
function runAttachmentStoreBranchArtifacts(
    state: RunAttachmentStoreState,
    branch: string | null
): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array
        .from(writers.values())
        .filter(function inBranch(writer) {
            return writer.branch === branch;
        })
        .map(function retainedArtifact(writer) {
            return writer.artifact();
        });
}
function runAttachmentStoreRetainsBranch(state: RunAttachmentStoreState, branch: string | null): boolean {
    return branch === null || state.branches.get(branch)?.() === true;
}
function runAttachmentStoreRetains(state: RunAttachmentStoreState, writer: StoredAttachment): boolean {
    return runAttachmentStoreRetainsBranch(state, writer.branch);
}
function runAttachmentStoreSelectedArtifacts(state: RunAttachmentStoreState): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array
        .from(writers.values())
        .filter(function (writer) {
            return runAttachmentStoreRetains(state, writer);
        })
        .map(function retainedArtifact(writer) {
            return writer.artifact();
        });
}
function runAttachmentStoreValidateOwner(state: RunAttachmentStoreState, operation: OpenOperation): void {
    const { branches, planned } = state;

    validateMetadata(operation);
    if (operation.branch !== null && !branches.has(operation.branch)) {
        throw new TypeError('Unknown attachment execution branch.');
    }
    if (operation.owner.kind === 'case' && !planned.has(workIdentityKey(operation.owner.work))) {
        throw new TypeError('Attachment owner is outside the selected work.');
    }
}
function runAttachmentStoreScopeBudget(
    state: RunAttachmentStoreState,
    channel: string,
    operation: OpenOperation
): AttachmentScopeBudget {
    const { budgets, options } = state;

    const key = operation.owner.kind === 'run'
        ? 'run'
        : `${operation.branch ?? channel}:${ownerKey(operation.owner)}`;
    const budget = budgets.get(key) ?? createAttachmentScopeBudget();
    budgets.set(key, budget);
    budget.reserve(options.limits);
    return budget;
}
function runAttachmentStoreInitialArtifact(
    state: RunAttachmentStoreState,
    operation: OpenOperation,
    writer: number,
    retention: AttachmentRetention
): RuntimeAttachmentArtifact {
    return {
        id: attachmentId(operation.owner, writer),
        source: 'instrumented',
        payload: {
            ...operation.metadata,
            capture: 'opt-in',
            capturedAtMicroseconds: state.options.captureTime(),
            content: retention.content(),
            kind: 'runtime-attachment',
            producer: operation.producer
        }
    };
}
type AttachmentWriterCreation = {
    readonly channel: string;
    readonly operation: OpenOperation;
    readonly writer: number;
    readonly filePath: string;
    readonly limit: number;
    readonly budget: AttachmentScopeBudget;
};
async function createRetainedAttachment(
    state: RunAttachmentStoreState,
    creation: AttachmentWriterCreation
): Promise<StoredAttachment> {
    const { channel, operation, writer, filePath, limit, budget } = creation;
    const retention = await createAttachmentRetention(
        operation.contentKind,
        state.options.projectRoot,
        filePath,
        limit
    );
    try {
        return createStoredAttachment(channel, operation, {
            initial: runAttachmentStoreInitialArtifact(state, operation, writer, retention),
            retention,
            budget
        });
    } catch (error: unknown) {
        await retention.finish({ kind: 'incomplete', reason: 'write-error' });
        await rm(filePath, { force: true });
        throw error;
    }
}
async function runAttachmentStoreCreateWriter(
    state: RunAttachmentStoreState,
    channel: string,
    operation: OpenOperation
): Promise<number> {
    const { sequence, options, writers } = state;

    const budget = runAttachmentStoreScopeBudget(state, channel, operation);
    const writer = sequence.read();
    sequence.write(sequence.read() + 1);
    const folder = createHash('sha256').update(ownerKey(operation.owner)).digest('hex');
    const filePath = path.join(options.directory, folder, `${writer}.attachment.bin`);
    const limit = operation.contentKind === 'binary'
        ? options.limits.maxArtifactBytes
        : options.limits.maxInlineBytes;
    writers.set(writer, await createRetainedAttachment(state, { channel, operation, writer, filePath, limit, budget }));
    return writer;
}
async function runAttachmentStoreStart(
    state: RunAttachmentStoreState,
    channel: string,
    operation: OpenOperation
): Promise<AttachmentResponse> {
    const { options } = state;

    runAttachmentStoreValidateOwner(state, operation);
    const writer = await runAttachmentStoreCreateWriter(state, channel, operation);
    if (operation.contentKind === 'binary') {
        await options.checkpoint(runAttachmentStoreArtifacts(state));
    }
    return { kind: 'opened', writer };
}
type AttachmentWriterOperation = Exclude<AttachmentOperation, { readonly kind: 'open'; }>;
async function processAttachmentWriterOperation(
    state: RunAttachmentStoreState,
    writer: StoredAttachment,
    operation: AttachmentWriterOperation
): Promise<AttachmentResponse> {
    if (operation.kind === 'close') {
        await writer.close(operation.reason);
        await state.options.checkpoint(runAttachmentStoreArtifacts(state));
        return { kind: 'closed', artifact: writer.artifact() };
    }
    if (operation.kind === 'omit') {
        writer.omit();
        return { kind: 'written' };
    }
    return await writer.write(operation.data, state.options.limits);
}
async function runAttachmentStoreProcessOperation(
    state: RunAttachmentStoreState,
    channel: string,
    operation: AttachmentOperation
): Promise<AttachmentResponse> {
    if (operation.kind === 'open') {
        return await runAttachmentStoreStart(state, channel, operation);
    }
    const writer = state.writers.get(operation.writer);
    if (writer?.channel !== channel) {
        throw new TypeError('Unknown attachment writer.');
    }
    return await processAttachmentWriterOperation(state, writer, operation);
}
async function runAttachmentStoreExchange(
    state: RunAttachmentStoreState,
    channel: string,
    operation: AttachmentOperation
): Promise<AttachmentResponse> {
    try {
        return await runAttachmentStoreProcessOperation(state, channel, operation);
    } catch (error: unknown) {
        return {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Attachment operation failed.',
            reason: 'operation-error'
        };
    }
}
async function runAttachmentStoreFinish(
    state: RunAttachmentStoreState,
    channel: string | null
): Promise<readonly AttachmentOwner[]> {
    const { writers } = state;

    const owners: AttachmentOwner[] = [];
    const selected = Array.from(writers.values()).filter(function inChannel(writer) {
        return channel === null || writer.channel === channel;
    });
    for (const writer of selected) {
        const owner = await writer.interrupt(channel === null ? 'unclosed' : 'interrupted');
        if (owner !== null && runAttachmentStoreRetains(state, writer)) {
            owners.push(owner);
        }
    }
    return owners;
}
async function runAttachmentStorePrune(
    state: RunAttachmentStoreState,
    retainedArtifacts: readonly RuntimeAttachmentArtifact[]
): Promise<void> {
    const { options, writers } = state;

    const retained = new Set(retainedArtifacts.map(function artifactSequence(artifact) {
        return artifact.id.sequence;
    }));
    const discarded = runAttachmentStoreArtifacts(state).filter(function discardedArtifact(artifact) {
        return !retained.has(artifact.id.sequence);
    });
    for (const artifact of discarded) {
        if (artifact.payload.content.kind === 'file') {
            await rm(path.resolve(options.projectRoot, artifact.payload.content.path), { force: true });
        }
        writers.delete(artifact.id.sequence);
    }
}
export function createAttachmentStore(options: AttachmentStoreOptions): AttachmentStore {
    const writers = new Map<number, StoredAttachment>();
    const branches = new Map<string, () => boolean>();
    const budgets = new Map<string, AttachmentScopeBudget>();
    const planned: ReadonlySet<string> = new Set(options.work.map(workIdentityKey));
    const sequence = createStoredRunValue<number>(0);
    const state: RunAttachmentStoreState = { options, writers, branches, budgets, planned, sequence };
    return {
        artifacts: runAttachmentStoreArtifacts.bind(null, state),
        retainsBranch: runAttachmentStoreRetainsBranch.bind(null, state),
        registerBranch: runAttachmentStoreRegisterBranch.bind(null, state),
        branchArtifacts: runAttachmentStoreBranchArtifacts.bind(null, state),
        selectedArtifacts: runAttachmentStoreSelectedArtifacts.bind(null, state),
        exchange: runAttachmentStoreExchange.bind(null, state),
        finish: runAttachmentStoreFinish.bind(null, state),
        prune: runAttachmentStorePrune.bind(null, state)
    };
}

type RetainedAttachmentRegistry = {
    readonly get: (sequence: number) => StoredAttachment | undefined;
    readonly set: (sequence: number, writer: StoredAttachment) => void;
    readonly delete: (sequence: number) => boolean;
    readonly values: () => Iterable<StoredAttachment>;
};
type AttachmentBranchRegistry = {
    readonly get: (branch: string) => (() => boolean) | undefined;
    readonly set: (branch: string, retain: () => boolean) => void;
    readonly has: (branch: string) => boolean;
};
type AttachmentBudgetRegistry = {
    readonly get: (scope: string) => AttachmentScopeBudget | undefined;
    readonly set: (scope: string, budget: AttachmentScopeBudget) => void;
};
