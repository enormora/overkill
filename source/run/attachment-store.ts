import { rm } from 'node:fs/promises';
import path from 'node:path';
import { workIdentityKey, type WorkId, type AttemptId } from '../engine/identity.ts';
import type { TestVerdict, RunResult } from '../engine/run-result.ts';
import type {
    RuntimeAttachmentArtifact,
    AttachmentLimits
} from '../engine/runtime-attachment.ts';
import { createFailureArtifactRetention, type FailureArtifactRetention } from './failure-artifact-retention.ts';
import {
    retainedAttachmentPath,
    createAttachmentScopeBudget,
    createStoredAttachment,
    type AttachmentScopeBudget,
    type StoredAttachment
} from './attachment-storage-writer.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import {
    attachmentScopeKey,
    attachmentMetadataBytes,
    type AttachmentOperation,
    type AttachmentOwner,
    type AttachmentResponse
} from './attachment-protocol.ts';
import { createAttachmentRetention, type AttachmentRetention } from './attachment-retention.ts';

type OpenOperation = Extract<AttachmentOperation, { readonly kind: 'open' | 'prepare'; }>;
export type AttachmentStore = {
    readonly settleAttempt: (
        work: WorkId,
        attempt: AttemptId,
        verdict: TestVerdict,
        branch: string | null
    ) => void;
    readonly settleResult: (result: RunResult) => void;
    readonly exchange: (channel: string, operation: AttachmentOperation) => Promise<AttachmentResponse>;
    readonly retainsBranch: (branch: string | null) => boolean;
    readonly registerBranch: (branch: string, retain: () => boolean) => void;
    readonly conflictArtifacts: (branch: string) => readonly RuntimeAttachmentArtifact[];
    readonly branchArtifacts: (branch: string | null) => readonly RuntimeAttachmentArtifact[];
    readonly selectedArtifacts: () => readonly RuntimeAttachmentArtifact[];
    readonly artifacts: () => readonly RuntimeAttachmentArtifact[];
    readonly prune: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
    readonly finish: (channel: string | null) => Promise<readonly AttachmentOwner[]>;
};
export type AttachmentStoreOptions = {
    readonly witnessDirectory: string;
    readonly projectRoot: string;
    readonly directory: string;
    readonly limits: AttachmentLimits;
    readonly work: readonly WorkId[];
    readonly captureTime: () => number;
    readonly checkpoint: (artifacts: readonly RuntimeAttachmentArtifact[]) => Promise<void>;
};
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
    readonly failureRetention: FailureArtifactRetention;
    readonly options: AttachmentStoreOptions;
    readonly writers: RetainedAttachmentRegistry;
    readonly branches: AttachmentBranchRegistry;
    readonly budgets: AttachmentBudgetRegistry;
    readonly planned: ReadonlySet<string>;
    readonly sequence: StoredRunValue<number>;
};
function runAttachmentStoreArtifacts(state: RunAttachmentStoreState): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array.from(writers.values(), function currentArtifact(writer) {
        return writer.artifact();
    });
}
function runAttachmentStoreRegisterBranch(state: RunAttachmentStoreState, branch: string, retain: () => boolean): void {
    const { branches } = state;

    branches.set(branch, retain);
}
function retainedArtifact(writer: StoredAttachment): RuntimeAttachmentArtifact {
    const artifact = writer.artifact();
    return artifact.payload.capture === 'opt-in' ? artifact : {
        ...artifact,
        payload: { ...artifact.payload, retention: { ...artifact.payload.retention, state: 'retained' } }
    };
}
function runAttachmentStoreBranchArtifacts(
    state: RunAttachmentStoreState,
    branch: string | null
): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array
        .from(writers.values())
        .filter(function inBranch(writer) {
            return writer.branch === branch && state.failureRetention.retains(writer);
        })
        .map(retainedArtifact);
}
function runAttachmentStoreRetainsBranch(state: RunAttachmentStoreState, branch: string | null): boolean {
    return branch === null || state.branches.get(branch)?.() === true;
}
function runAttachmentStoreRetains(state: RunAttachmentStoreState, writer: StoredAttachment): boolean {
    const artifact = writer.artifact();
    return runAttachmentStoreRetainsBranch(state, writer.branch) &&
        (artifact.payload.capture === 'opt-in' || state.failureRetention.retains(writer));
}
function runAttachmentStoreSelectedArtifacts(state: RunAttachmentStoreState): readonly RuntimeAttachmentArtifact[] {
    const { writers } = state;

    return Array
        .from(writers.values())
        .filter(function (writer) {
            return runAttachmentStoreRetains(state, writer);
        })
        .map(retainedArtifact);
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
        : `${operation.branch ?? channel}:${attachmentScopeKey(operation.owner)}`;
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
        id: {
            ...attachmentId(operation.owner, writer),
            subtype: operation.kind === 'prepare' ? operation.subtype : 'attachment'
        },
        source: operation.kind === 'prepare' ? operation.source : 'instrumented',
        payload: {
            ...operation.metadata,
            ...operation.kind === 'prepare'
                ? {
                    capture: 'automatic' as const,
                    retention: { condition: operation.condition, state: 'prepared' as const }
                }
                : { capture: 'opt-in' as const },
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
    const filePath = retainedAttachmentPath(options, operation, writer);
    const limit = operation.contentKind === 'binary' || operation.kind === 'prepare' && operation.subtype === 'witness'
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
type AttachmentWriterOperation = Exclude<
    AttachmentOperation,
    { readonly kind: 'open' | 'prepare' | 'resource-consumer' | 'resource-failure'; }
>;
async function checkpointCapturedWrite(
    state: RunAttachmentStoreState,
    writer: StoredAttachment,
    data: string
): Promise<AttachmentResponse> {
    const response = await writer.write(data, state.options.limits);
    if (writer.artifact().payload.capture === 'automatic') {
        await state.options.checkpoint(runAttachmentStoreArtifacts(state));
    }
    return response;
}
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
    return await checkpointCapturedWrite(state, writer, operation.data);
}
function registerResourceEvidence(
    state: RunAttachmentStoreState,
    channel: string,
    operation: Extract<AttachmentOperation, { readonly kind: 'resource-consumer' | 'resource-failure'; }>
): AttachmentResponse {
    if (operation.kind === 'resource-consumer') {
        if (!state.planned.has(workIdentityKey(operation.work))) {
            throw new TypeError('Resource consumer is outside selected work.');
        }
        state.failureRetention.consume(channel, operation.boundary, operation.work);
    } else {
        state.failureRetention.markResourceFailure(channel, operation.boundary);
    }
    return { kind: 'written' };
}
function isOpenOperation(operation: AttachmentOperation): operation is OpenOperation {
    return operation.kind === 'open' || operation.kind === 'prepare';
}
async function runAttachmentStoreProcessOperation(
    state: RunAttachmentStoreState,
    channel: string,
    operation: AttachmentOperation
): Promise<AttachmentResponse> {
    if (operation.kind === 'resource-consumer' || operation.kind === 'resource-failure') {
        return registerResourceEvidence(state, channel, operation);
    }
    if (isOpenOperation(operation)) {
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
async function finishStoredAttachment(
    state: RunAttachmentStoreState,
    channel: string | null,
    writer: StoredAttachment
): Promise<AttachmentOwner | null> {
    const owner = await writer.interrupt(
        channel === null && !state.failureRetention.interrupted() ? 'unclosed' : 'interrupted'
    );
    return writer.artifact().payload.capture === 'opt-in' && runAttachmentStoreRetains(state, writer) ? owner : null;
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
        const owner = await finishStoredAttachment(state, channel, writer);
        if (owner !== null) {
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
        writers.get(artifact.id.sequence)?.release();
        writers.delete(artifact.id.sequence);
    }
}
export function createAttachmentStore(options: AttachmentStoreOptions): AttachmentStore {
    const writers = new Map<number, StoredAttachment>();
    const branches = new Map<string, () => boolean>();
    const budgets = new Map<string, AttachmentScopeBudget>();
    const planned: ReadonlySet<string> = new Set(options.work.map(workIdentityKey));
    const sequence = createStoredRunValue<number>(0);
    const state: RunAttachmentStoreState = {
        options,
        writers,
        branches,
        budgets,
        planned,
        sequence,
        failureRetention: createFailureArtifactRetention()
    };
    return {
        settleAttempt: state.failureRetention.settleAttempt,
        settleResult: state.failureRetention.settleResult,
        artifacts: runAttachmentStoreArtifacts.bind(null, state),
        retainsBranch: runAttachmentStoreRetainsBranch.bind(null, state),
        registerBranch: runAttachmentStoreRegisterBranch.bind(null, state),
        conflictArtifacts(branch) {
            return Array
                .from(writers.values())
                .filter(function conflictBranch(writer) {
                    return writer.branch === branch;
                })
                .map(retainedArtifact);
        },
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
