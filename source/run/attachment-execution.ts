import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunnerError } from '../engine/run-result.ts';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import type { AttachmentMetadata, AttachmentProducer, RuntimeAttachments } from '../engine/runtime-attachment.ts';
import type { AttachmentContext } from '../packages/resources/attachment-context.entry-point.ts';
import { AttachmentOperationError, createAttachmentFailure, type AttachmentRejection } from './attachment-failure.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import type {
    AttachmentExchange,
    AttachmentOperation,
    AttachmentOwner,
    AttachmentResponse
} from './attachment-protocol.ts';
import { snapshotAttachmentJson } from './attachment-json.ts';
import { createAttachmentStream, copyAttachmentFile, type AttachmentStream } from './attachment-writer.ts';

type AttachmentAttempt = {
    readonly owner: AttachmentOwner;
    readonly end: () => void;
    readonly isActive: () => boolean;
};
function createAttachmentAttempt(work: WorkId, attempt: AttemptId): AttachmentAttempt {
    const owner: AttachmentOwner = { attempt, kind: 'case', work };
    const active = createStoredRunValue<boolean>(true);
    function end(): void {
        active.write(false);
    }
    function isActive(): boolean {
        return active.read();
    }

    return { owner, end, isActive };
}

export type AttachmentExecution = {
    readonly context: AttachmentContext;
    readonly runAttempt: <Value>(work: WorkId, attempt: AttemptId, run: () => Promise<Value>) => Promise<Value>;
    readonly runBranch: <Value>(branch: string | null, run: () => Promise<Value>) => Promise<Value>;
    readonly takeErrors: (owner: AttachmentOwner) => readonly RunnerError[];
    readonly finish: () => Promise<readonly RunnerError[]>;
};
function ownerKey(owner: AttachmentOwner): string {
    return owner.kind === 'run' ? 'run' : `${workIdentityKey(owner.work)}:${owner.attempt.index}`;
}
const maxFailuresPerOwner = 100;

type AttachmentExecutionSessionState = {
    readonly closed: StoredRunValue<boolean>;
    readonly exchange: AttachmentExchange;
    readonly maxInlineBytes: number;
    readonly currentAttempt: AsyncLocalStorage<AttachmentAttempt>;
    readonly currentBranch: AsyncLocalStorage<string | null>;
    readonly writers: OpenAttachmentRegistry;
    readonly failures: AttachmentFailureRegistry;
};
function attachmentExecutionSessionFail(
    state: AttachmentExecutionSessionState,
    rejection: AttachmentRejection
): AttachmentOperationError {
    const { owner, drift } = rejection;
    const { failures } = state;

    const error = createAttachmentFailure(rejection, state.currentBranch.getStore() ?? null);
    const key = ownerKey(drift ? { kind: 'run' } : owner);
    const errors = failures.get(key) ?? [];
    if (errors.length < maxFailuresPerOwner) {
        state.failures.set(key, [ ...errors, error ]);
    }
    return error;
}
function attachmentExecutionSessionVerify(
    state: AttachmentExecutionSessionState,
    window: AttachmentAttempt | undefined
): void {
    if (state.closed.read()) {
        throw attachmentExecutionSessionFail(state, {
            owner: window?.owner ?? { kind: 'run' },
            message: 'Attachment escaped its integration run.',
            reason: 'expired-run',
            drift: true
        });
    }
    if (window?.isActive() === false) {
        throw attachmentExecutionSessionFail(state, {
            owner: window.owner,
            message: 'Attachment escaped its test attempt.',
            reason: 'expired-attempt',
            drift: true
        });
    }
}
async function attachmentExecutionSessionTransport(
    state: AttachmentExecutionSessionState,
    operation: AttachmentOperation,
    owner: AttachmentOwner
): Promise<AttachmentResponse> {
    try {
        return await state.exchange(operation);
    } catch (error: unknown) {
        throw attachmentExecutionSessionFail(state, {
            owner,
            message: error instanceof Error ? error.message : 'Attachment transport failed.',
            reason: 'transport',
            drift: false
        });
    }
}
async function attachmentExecutionSessionSend(
    state: AttachmentExecutionSessionState,
    operation: AttachmentOperation,
    owner: AttachmentOwner
): Promise<AttachmentResponse> {
    const response = await attachmentExecutionSessionTransport(state, operation, owner);
    if (response.kind === 'error') {
        throw attachmentExecutionSessionFail(state, {
            owner,
            message: response.message,
            reason: response.reason,
            drift: false
        });
    }
    return response;
}
function activeAttachmentWindow(state: AttachmentExecutionSessionState): AttachmentAttempt | undefined {
    const window = state.currentAttempt.getStore();
    attachmentExecutionSessionVerify(state, window);
    return window;
}
async function attachmentExecutionSessionOpen(
    state: AttachmentExecutionSessionState,
    metadata: AttachmentMetadata,
    kind: 'binary' | 'json' | 'text',
    producer: AttachmentProducer
): Promise<AttachmentStream> {
    const { currentBranch, writers } = state;

    const window = activeAttachmentWindow(state);
    const owner = window?.owner ?? { kind: 'run' };
    const response = await attachmentExecutionSessionSend(state, {
        branch: currentBranch.getStore() ?? null,
        contentKind: kind,
        kind: 'open',
        metadata,
        owner,
        producer
    }, owner);
    if (response.kind !== 'opened') {
        throw attachmentExecutionSessionFail(state, {
            owner,
            message: 'Attachment open returned an invalid reply.',
            reason: 'protocol',
            drift: false
        });
    }
    const token = Symbol('attachment-writer');
    const writer = createAttachmentStream(
        {
            fail(message, reason) {
                return attachmentExecutionSessionFail(state, {
                    owner,
                    message,
                    reason,
                    drift: false
                });
            },
            owner,
            release() {
                writers.delete(token);
            },
            async send(operation) {
                return attachmentExecutionSessionSend(state, operation, owner);
            },
            verify() {
                attachmentExecutionSessionVerify(state, window);
            }
        },
        response.writer,
        kind
    );
    writers.set(token, writer);
    return writer;
}
function attachmentExecutionSessionJsonSnapshot(
    state: AttachmentExecutionSessionState,
    value: unknown
): ReturnType<typeof snapshotAttachmentJson> {
    const { currentAttempt } = state;

    try {
        return snapshotAttachmentJson(value, state.maxInlineBytes);
    } catch (error: unknown) {
        const owner = currentAttempt.getStore()?.owner ?? { kind: 'run' };
        throw attachmentExecutionSessionFail(state, {
            owner,
            message: error instanceof Error ? error.message : 'Invalid JSON attachment.',
            reason: 'invalid-json',
            drift: false
        });
    }
}
async function attachmentExecutionSessionJson(
    state: AttachmentExecutionSessionState,
    metadata: AttachmentMetadata,
    value: unknown,
    producer: AttachmentProducer
): Promise<Awaited<ReturnType<RuntimeAttachments['json']>>> {
    activeAttachmentWindow(state);
    const snapshot = attachmentExecutionSessionJsonSnapshot(state, value);
    const writer = await attachmentExecutionSessionOpen(state, metadata, 'json', producer);
    if (snapshot === null) {
        await writer.omit();
    } else {
        await writer.write(snapshot.encoded);
    }
    return await writer.close();
}
async function attachmentExecutionSessionFile(
    state: AttachmentExecutionSessionState,
    metadata: AttachmentMetadata,
    filePath: string,
    producer: AttachmentProducer
): Promise<Awaited<ReturnType<RuntimeAttachments['file']>>> {
    const writer = await attachmentExecutionSessionOpen(state, metadata, 'binary', producer);
    try {
        await copyAttachmentFile(writer, filePath);
    } catch (error: unknown) {
        await writer.finish('write-error');
        if (error instanceof AttachmentOperationError) {
            throw error;
        }
        throw attachmentExecutionSessionFail(state, {
            owner: writer.owner,
            message: error instanceof Error ? error.message : 'Attachment file read failed.',
            reason: 'file-read',
            drift: false
        });
    }
    return await writer.close();
}
function attachmentExecutionSessionCapabilities(
    state: AttachmentExecutionSessionState,
    producer: AttachmentProducer
): RuntimeAttachments {
    return {
        async file(metadata, filePath) {
            return attachmentExecutionSessionFile(state, metadata, filePath, producer);
        },
        async json(metadata, value) {
            return attachmentExecutionSessionJson(state, metadata, value, producer);
        },
        async open(metadata) {
            return attachmentExecutionSessionOpen(state, metadata, metadata.kind, producer);
        }
    };
}
async function attachmentExecutionSessionFinishOwner(
    state: AttachmentExecutionSessionState,
    owner: AttachmentOwner
): Promise<void> {
    const { writers } = state;

    const selected = Array.from(writers.values()).filter(function ownedWriter(writer) {
        return ownerKey(writer.owner) === ownerKey(owner);
    });
    await Promise.allSettled(selected.map(async function finishOwnedWriter(writer) {
        await writer.finish('unclosed');
    }));
}
function attachmentExecutionSessionTakeErrors(
    state: AttachmentExecutionSessionState,
    owner: AttachmentOwner
): readonly RunnerError[] {
    const { failures } = state;

    const key = ownerKey(owner);
    const errors = failures.get(key) ?? [];
    failures.delete(key);
    return errors.flatMap(function unreportedError(error) {
        const failure = error.take();
        return failure === null ? [] : [ failure ];
    });
}
async function attachmentExecutionSessionFinish(
    state: AttachmentExecutionSessionState
): Promise<readonly RunnerError[]> {
    state.closed.write(true);
    await attachmentExecutionSessionFinishOwner(state, { kind: 'run' });
    return attachmentExecutionSessionTakeErrors(state, { kind: 'run' });
}
async function attachmentExecutionSessionOwnedAttempt<Value>(
    state: AttachmentExecutionSessionState,
    window: AttachmentAttempt,
    run: () => Promise<Value>
): Promise<Value> {
    try {
        return await run();
    } finally {
        window.end();
        await attachmentExecutionSessionFinishOwner(state, window.owner);
    }
}
async function attachmentExecutionSessionRunAttempt<Value>(
    state: AttachmentExecutionSessionState,
    work: WorkId,
    attempt: AttemptId,
    run: () => Promise<Value>
): Promise<Value> {
    const { currentAttempt } = state;

    const window = createAttachmentAttempt(work, attempt);
    return await currentAttempt.run(window, async function () {
        return attachmentExecutionSessionOwnedAttempt(state, window, run);
    });
}
async function attachmentExecutionSessionRunBranch<Value>(
    state: AttachmentExecutionSessionState,
    branch: string | null,
    run: () => Promise<Value>
): Promise<Value> {
    const { currentBranch } = state;

    return await currentBranch.run(branch, run);
}
export function createAttachmentExecution(
    exchange: AttachmentExchange,
    maxInlineBytes: number
): AttachmentExecution {
    const currentAttempt = new AsyncLocalStorage<AttachmentAttempt>();
    const currentBranch = new AsyncLocalStorage<string | null>();
    const writers = new Map<symbol, AttachmentStream>();
    const failures = new Map<string, readonly AttachmentOperationError[]>();
    const state: AttachmentExecutionSessionState = {
        closed: createStoredRunValue(false),
        exchange,
        maxInlineBytes,
        currentAttempt,
        currentBranch,
        writers,
        failures
    };
    const context: AttachmentContext = { forProducer: attachmentExecutionSessionCapabilities.bind(null, state) };
    return {
        context,
        takeErrors: attachmentExecutionSessionTakeErrors.bind(null, state),
        finish: attachmentExecutionSessionFinish.bind(null, state),
        async runAttempt(work, attempt, run) {
            return await attachmentExecutionSessionRunAttempt(state, work, attempt, run);
        },
        async runBranch(branch, run) {
            return await attachmentExecutionSessionRunBranch(state, branch, run);
        }
    };
}

type OpenAttachmentRegistry = {
    readonly values: () => Iterable<AttachmentStream>;
    readonly set: (token: symbol, writer: AttachmentStream) => void;
    readonly delete: (token: symbol) => boolean;
};
type AttachmentFailureRegistry = {
    readonly get: (scope: string) => readonly AttachmentOperationError[] | undefined;
    readonly set: (scope: string, errors: readonly AttachmentOperationError[]) => void;
    readonly delete: (scope: string) => boolean;
};
