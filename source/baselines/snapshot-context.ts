import { AsyncLocalStorage } from 'node:async_hooks';
import type { BaselineJson } from './baseline-model.ts';

type ByteSnapshot = { readonly kind: 'bytes'; readonly actual: Uint8Array; };
type TextSnapshot = { readonly kind: 'text'; readonly actual: string; };
type ValueSnapshot = { readonly kind: 'value'; readonly actual: BaselineJson; };
export type SnapshotInput = { readonly name: string; } & (ByteSnapshot | TextSnapshot | ValueSnapshot);

type AcceptedSnapshot = { readonly kind: 'accepted'; };
type ComparedSnapshot = { readonly kind: 'compare'; readonly actual: unknown; readonly expected: unknown; };
type MissingSnapshot = { readonly kind: 'missing'; };
export type SnapshotComparison = AcceptedSnapshot | ComparedSnapshot | MissingSnapshot;

export type SnapshotContext = {
    readonly evaluate: (input: SnapshotInput) => Promise<SnapshotComparison>;
};

const contextKey = Symbol.for('@overkill-dev/baselines/snapshot-context/v1');

type SnapshotContextStorage = Readonly<AsyncLocalStorage<SnapshotContext>>;

function isSnapshotContextStorage(value: unknown): value is SnapshotContextStorage {
    return value instanceof AsyncLocalStorage;
}

function sharedSnapshotContext(): SnapshotContextStorage {
    const existing: unknown = Reflect.get(globalThis, contextKey);
    if (isSnapshotContextStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<SnapshotContext>();
    Object.defineProperty(globalThis, contextKey, { value: created });
    return created;
}

const context = sharedSnapshotContext();

export async function evaluateSnapshot(input: SnapshotInput): Promise<SnapshotComparison> {
    const active = context.getStore();
    if (active === undefined) {
        throw new TypeError('Snapshots require an integration profile with baselines.snapshots enabled.');
    }
    return await active.evaluate(input);
}

export async function runWithSnapshotContext<Value>(
    active: SnapshotContext,
    run: () => Promise<Value>
): Promise<Value> {
    return await context.run(active, run);
}
