import { createStoredValue, type StoredValue } from '../stored-value.ts';
import {
    defaultAttachmentLimits,
    type AttachmentWriter,
    type AttachmentMetadata,
    type RuntimeAttachments
} from '../engine/runtime-attachment.ts';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import { currentAttachmentContext, type AttachmentContext } from './attachment-context.ts';
import { resourceFailureAttachments, type ResourceFailureContext } from './resource-failure-context.ts';

export type FailureArtifactStream = {
    readonly write: (chunk: string) => void;
    readonly close: () => Promise<void>;
};

type FailureStreamRegistry = {
    readonly get: (key: string) => ReadonlySet<FailureArtifactStream> | undefined;
    readonly set: (key: string, streams: ReadonlySet<FailureArtifactStream>) => void;
    readonly delete: (key: string) => boolean;
};
type FailureRunRegistry = {
    readonly get: (context: AttachmentContext) => FailureStreamRegistry | undefined;
    readonly set: (context: AttachmentContext, streams: FailureStreamRegistry) => void;
};
const registryKey = Symbol.for('@overkill-dev/failure-artifact-streams/v2');
function isFailureRunRegistry(value: unknown): value is FailureRunRegistry {
    return value instanceof WeakMap;
}
function sharedFailureRuns(): FailureRunRegistry {
    const existing: unknown = Reflect.get(globalThis, registryKey);
    if (isFailureRunRegistry(existing)) {
        return existing;
    }
    const created: FailureRunRegistry = new WeakMap();
    Object.defineProperty(globalThis, registryKey, { value: created });
    return created;
}
const runs = sharedFailureRuns();
function currentFailureStreams(): FailureStreamRegistry | null {
    const context = currentAttachmentContext();
    if (context === null) {
        return null;
    }
    const streams = runs.get(context) ?? new Map<string, ReadonlySet<FailureArtifactStream>>();
    runs.set(context, streams);
    return streams;
}
function attemptKey(work: WorkId, attempt: AttemptId): string {
    return `${workIdentityKey(work)}:${attempt.index}`;
}
export async function closeAttemptFailureStreams(work: WorkId, attempt: AttemptId): Promise<void> {
    const streams = currentFailureStreams();
    if (streams === null) {
        return;
    }
    const key = attemptKey(work, attempt);
    const owned = streams.get(key) ?? new Set<FailureArtifactStream>();
    streams.delete(key);
    const completed = await Promise.allSettled(Array.from(owned, async function closeOwnedCapture(stream) {
        return stream.close();
    }));
    const failures = completed.flatMap(function captureFailure(result) {
        return result.status === 'rejected'
            ? [ new Error('Failure artifact stream did not finish.', { cause: result.reason }) ]
            : [];
    });
    if (failures.length > 0) {
        throw new AggregateError(failures, 'Failure artifact streams could not finish.');
    }
}

type CaptureState = {
    readonly chunks: StoredValue<readonly string[]>;
    readonly attachments: RuntimeAttachments;
    readonly metadata: AttachmentMetadata & { readonly kind: 'text'; };
    readonly queuedBytes: StoredValue<number>;
    readonly truncated: StoredValue<boolean>;
    readonly failure: StoredValue<Error | null>;
    readonly closed: StoredValue<boolean>;
    readonly lateReported: StoredValue<boolean>;
    readonly writer: StoredValue<AttachmentWriter<Uint8Array | string> | null>;
    readonly pending: StoredValue<Promise<void> | null>;
};
async function drainCapture(state: CaptureState): Promise<void> {
    const writer = state.writer.read() ?? await state.attachments.open(state.metadata);
    state.writer.write(writer);
    while (state.chunks.read().length > 0) {
        const batch = state.chunks.read();
        state.chunks.write([]);
        for (const chunk of batch) {
            await writer.write(chunk);
            state.queuedBytes.write(state.queuedBytes.read() - Buffer.byteLength(chunk));
        }
    }
}
async function capturePending(state: CaptureState): Promise<void> {
    try {
        await drainCapture(state);
    } catch (error: unknown) {
        state.failure.write(
            error instanceof Error
                ? error
                : new Error('Failure artifact stream could not capture output.', { cause: error })
        );
        state.chunks.write([]);
        state.queuedBytes.write(0);
    } finally {
        state.pending.write(null);
    }
}
async function observeLateCapture(state: CaptureState, chunk: string): Promise<void> {
    const writer = state.writer.read();
    const writing = writer === null ? state.attachments.json(state.metadata, null) : writer.write(chunk);
    try {
        await writing;
    } catch (error: unknown) {
        state.failure.write(
            error instanceof Error ? error : new Error('Late failure capture failed.', { cause: error })
        );
    }
}
function captureAcceptsWrite(state: CaptureState, chunk: string): boolean {
    if (state.closed.read() && !state.lateReported.read()) {
        state.lateReported.write(true);
        state.pending.write(observeLateCapture(state, chunk));
    }
    return !state.closed.read() && !state.truncated.read() && state.failure.read() === null;
}
function queueCapture(state: CaptureState, chunk: string): void {
    const available = defaultAttachmentLimits.maxInlineBytes - state.queuedBytes.read();
    const limited = Buffer.byteLength(chunk) > available;
    const decoder = new TextDecoder();
    const prefix = limited
        ? decoder.decode(Buffer.from(chunk).subarray(0, available), { stream: true })
        : chunk;
    state.truncated.write(limited);
    state.chunks.write([ ...state.chunks.read(), prefix ]);
    state.queuedBytes.write(state.queuedBytes.read() + Buffer.byteLength(prefix));
}
function writeCapture(state: CaptureState, chunk: string): void {
    if (!captureAcceptsWrite(state, chunk)) {
        return;
    }
    queueCapture(state, chunk);
    if (state.pending.read() === null) {
        state.pending.write(capturePending(state));
    }
}
async function closeCapture(state: CaptureState): Promise<void> {
    if (state.closed.read()) {
        return;
    }
    state.closed.write(true);
    await state.pending.read();
    const writer = state.writer.read();
    if (writer !== null) {
        await (state.truncated.read() ? writer.close('capture-limit') : writer.close());
    }
    const failure = state.failure.read();
    if (failure !== null) {
        throw failure;
    }
}
function createCaptureState(attachments: RuntimeAttachments, name: string, mediaType: string): CaptureState {
    return {
        attachments,
        metadata: { kind: 'text', name, mediaType },
        chunks: createStoredValue<readonly string[]>([]),
        queuedBytes: createStoredValue(0),
        truncated: createStoredValue(false),
        failure: createStoredValue<Error | null>(null),
        closed: createStoredValue(false),
        lateReported: createStoredValue(false),
        writer: createStoredValue<AttachmentWriter<Uint8Array | string> | null>(null),
        pending: createStoredValue<Promise<void> | null>(null)
    };
}
function registerAttemptStream(context: ResourceFailureContext, stream: FailureArtifactStream): void {
    const streams = currentFailureStreams();
    if (context.condition.kind === 'attempt' && streams !== null) {
        const key = attemptKey(context.condition.work, context.condition.attempt);
        const owned = streams.get(key) ?? new Set<FailureArtifactStream>();
        streams.set(key, new Set([ ...owned, stream ]));
    }
}
export function createFailureArtifactStream(
    context: ResourceFailureContext,
    source: 'boundary-captured' | 'instrumented',
    name: string,
    mediaType: string
): FailureArtifactStream | null {
    const attachments = resourceFailureAttachments(context, source);
    if (attachments === null) {
        return null;
    }
    const state = createCaptureState(attachments, name, mediaType);
    const stream: FailureArtifactStream = {
        write: writeCapture.bind(null, state),
        close: closeCapture.bind(null, state)
    };
    registerAttemptStream(context, stream);
    return stream;
}
