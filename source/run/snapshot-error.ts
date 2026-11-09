import type { AttemptId, WorkId, RunnerError } from './run-engine-primitives.ts';

const snapshotErrorKey = Symbol.for('@overkill-dev/run/snapshot-errors/v1');
type SnapshotErrors = Readonly<WeakSet<Error>>;

function isSnapshotErrors(value: unknown): value is SnapshotErrors {
    return value instanceof WeakSet;
}

function sharedSnapshotErrors(): SnapshotErrors {
    const existing: unknown = Reflect.get(globalThis, snapshotErrorKey);
    if (isSnapshotErrors(existing)) {
        return existing;
    }
    const created = new WeakSet<Error>();
    Object.defineProperty(globalThis, snapshotErrorKey, { value: created });
    return created;
}

const snapshotErrors = sharedSnapshotErrors();

export function markSnapshotExecutionError(cause: unknown): Error {
    const error = cause instanceof Error ? cause : new Error(String(cause), { cause });
    snapshotErrors.add(error);
    return error;
}

export function isSnapshotExecutionError(value: unknown): value is Error {
    return value instanceof Error && snapshotErrors.has(value);
}

export function snapshotRunnerError(error: Error, work: WorkId, attempt: AttemptId): RunnerError {
    return {
        attributedTo: work.case,
        attributedToWork: work,
        attributedToAttempt: attempt,
        cause: error,
        diagnostics: [],
        message: error.message,
        subtype: 'artifact'
    };
}
