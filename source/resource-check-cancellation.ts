import { workIdentityKey, type WorkId, type AttemptId } from './engine/identity.ts';
import { currentExecutionOwner } from './execution-ownership.ts';
import { createStoredValue, type StoredValue } from './stored-value.ts';

function attemptCancellationKey(work: WorkId, attempt: AttemptId): string {
    return `${workIdentityKey(work)}:${attempt.index}`;
}
type ResourceCheckCancellationRegistry = StoredValue<
    ReadonlyMap<symbol, ReadonlyMap<string, (cause: unknown) => void>>
>;
const unownedRun = Symbol.for('@overkill-dev/resource-checks/unowned/v1');
const cancellationRegistryKey = Symbol.for('@overkill-dev/resource-checks/cancellation/v1');
function isCancellationRegistry(value: unknown): value is ResourceCheckCancellationRegistry {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'read') === 'function' &&
        typeof Reflect.get(value, 'write') === 'function';
}
function cancellationRegistry(): ResourceCheckCancellationRegistry {
    const existing: unknown = Reflect.get(globalThis, cancellationRegistryKey);
    if (isCancellationRegistry(existing)) {
        return existing;
    }
    const created = createStoredValue<ReadonlyMap<symbol, ReadonlyMap<string, (cause: unknown) => void>>>(new Map());
    Reflect.set(globalThis, cancellationRegistryKey, created);
    return created;
}
const runs = cancellationRegistry();
export function resourceCheckRunIdentity(): symbol {
    return currentExecutionOwner()?.run?.identity ?? unownedRun;
}

function releaseResourceCheckCancellation(runIdentity: symbol, identity: string): void {
    const attempts = new Map(runs.read().get(runIdentity));
    const active = new Map(runs.read());
    attempts.delete(identity);
    if (attempts.size === 0) {
        active.delete(runIdentity);
    } else {
        active.set(runIdentity, attempts);
    }
    runs.write(active);
}
export async function withResourceCheckCancellation<Value>(
    work: WorkId,
    attempt: AttemptId,
    abort: (cause: unknown) => void,
    run: () => Promise<Value>
): Promise<Value> {
    const runIdentity = resourceCheckRunIdentity();
    const attempts = new Map(runs.read().get(runIdentity));
    const identity = attemptCancellationKey(work, attempt);
    attempts.set(identity, abort);
    runs.write(new Map([ ...runs.read(), [ runIdentity, attempts ] ]));
    try {
        return await run();
    } finally {
        releaseResourceCheckCancellation(runIdentity, identity);
    }
}
export function stopResourceCheckAttempt(work: WorkId, attempt: AttemptId, cause: unknown, runIdentity: symbol): void {
    runs.read().get(runIdentity)?.get(attemptCancellationKey(work, attempt))?.(cause);
}
export function stopResourceCheckWork(work: WorkId, cause: unknown, runIdentity: symbol): void {
    const prefix = `${workIdentityKey(work)}:`;
    const attempts = runs.read().get(runIdentity) ?? [];
    for (const [ identity, abort ] of attempts) {
        if (identity.startsWith(prefix)) {
            abort(cause);
        }
    }
}
