import { AsyncLocalStorage } from 'node:async_hooks';

const transcriptObservationKey = Symbol.for('@overkill-dev/transcript-observation/v1');
const transcriptIdentity = Symbol.for('@overkill-dev/transcript');

export type TranscriptScope = Readonly<Record<string, unknown>>;

export type TranscriptEntry = readonly [kind: string, ...values: readonly unknown[]];

export type TranscriptView<Entry extends TranscriptEntry = TranscriptEntry> = {
    readonly entryCount: number;
    readonly entries: readonly Entry[];
    readonly firstEntry: Entry | null;
    readonly lastEntry: Entry | null;
    readonly nthEntry: (index: number) => Entry | null;
};

export type TranscriptStore<Entry extends TranscriptEntry> = {
    readonly record: (...entry: Entry) => void;
    readonly recordInScope: (scope: TranscriptScope | null, ...entry: Entry) => void;
    readonly reset: () => void;
    readonly view: TranscriptView<Entry>;
};

type TranscriptScopeStorage = Readonly<AsyncLocalStorage<TranscriptScope | null>>;
const scopeStorageKey = Symbol.for('@overkill-dev/transcript-scope/v1');
function isTranscriptScopeStorage(value: unknown): value is TranscriptScopeStorage {
    return value instanceof AsyncLocalStorage;
}
function sharedTranscriptScope(): TranscriptScopeStorage {
    const existing: unknown = Reflect.get(globalThis, scopeStorageKey);
    if (isTranscriptScopeStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<TranscriptScope | null>();
    Object.defineProperty(globalThis, scopeStorageKey, { value: created });
    return created;
}
const activeTranscriptScope = sharedTranscriptScope();
const noEntries = Object.freeze([]);

type RuntimeTranscriptView = TranscriptView & {
    readonly [transcriptIdentity]: true;
};

function validIndex(index: number): boolean {
    return Number.isSafeInteger(index) && index >= 0;
}

export function brandTranscriptView<Subject extends TranscriptView>(subject: Subject): Subject {
    Object.defineProperty(subject, transcriptIdentity, {
        enumerable: false,
        value: true
    });

    return Object.freeze(subject);
}

export function currentTranscriptScope(): TranscriptScope | null {
    return activeTranscriptScope.getStore() ?? null;
}

export async function runWithTranscriptScope<Value>(
    scope: TranscriptScope | null,
    run: () => Promise<Value>
): Promise<Value> {
    return await activeTranscriptScope.run(scope, run);
}

type TranscriptObservers<Entry extends TranscriptEntry> = {
    readonly add: (observer: TranscriptObserver<Entry>) => unknown;
    readonly delete: (observer: TranscriptObserver<Entry>) => boolean;
};
function brandedView<Entry extends TranscriptEntry>(
    currentEntries: () => readonly Entry[],
    listeners: TranscriptObservers<Entry>
): TranscriptView<Entry> {
    const view = {
        [transcriptObservationKey](observe: TranscriptObserver<Entry>) {
            listeners.add(observe);
            return function stopTranscriptObservation() {
                listeners.delete(observe);
            };
        },
        get entries() {
            return currentEntries();
        },
        get entryCount() {
            return currentEntries().length;
        },
        get firstEntry() {
            return currentEntries()[0] ?? null;
        },
        get lastEntry() {
            return currentEntries().at(-1) ?? null;
        },
        nthEntry(index: number) {
            return validIndex(index) ? currentEntries()[index] ?? null : null;
        }
    };

    return brandTranscriptView(view);
}

export function createTranscriptStore<Entry extends TranscriptEntry>(): TranscriptStore<Entry> {
    const entries: Entry[] = [];
    const listeners = new Set<TranscriptObserver<Entry>>();
    let scopedEntries = new WeakMap<TranscriptScope, Entry[]>();

    function recordInScope(scope: TranscriptScope | null, entry: Entry): void {
        entries.push(entry);
        for (const observe of listeners) {
            observe(entry, scope);
        }
        if (scope !== null) {
            const scopeEntries = scopedEntries.get(scope) ?? [];

            scopeEntries.push(entry);
            scopedEntries.set(scope, scopeEntries);
        }
    }

    function currentEntries(): readonly Entry[] {
        const scope = currentTranscriptScope();

        return scope === null ? entries : scopedEntries.get(scope) ?? noEntries;
    }

    const view = brandedView(currentEntries, listeners);
    return Object.freeze({
        record(...entry: Entry) {
            recordInScope(currentTranscriptScope(), entry);
        },
        recordInScope(scope, ...entry: Entry) {
            recordInScope(scope, entry);
        },
        reset() {
            entries.length = 0;
            scopedEntries = new WeakMap();
        },
        view
    });
}

export function isTranscriptView(value: unknown): value is RuntimeTranscriptView {
    return typeof value === 'object' && value !== null && Reflect.get(value, transcriptIdentity) === true;
}

type TranscriptObserver<Entry extends TranscriptEntry> = (entry: Entry, scope: TranscriptScope | null) => void;
type ObservableTranscript<Entry extends TranscriptEntry> = TranscriptView<Entry> & {
    readonly [transcriptObservationKey]: (observe: TranscriptObserver<Entry>) => () => void;
};
function isObservableTranscript<Entry extends TranscriptEntry>(
    view: TranscriptView<Entry>
): view is ObservableTranscript<Entry> {
    return typeof Reflect.get(view, transcriptObservationKey) === 'function';
}
export function observeTranscriptEntries<Entry extends TranscriptEntry>(
    view: TranscriptView<Entry>,
    observe: TranscriptObserver<Entry>
): () => void {
    return isObservableTranscript(view)
        ? view[transcriptObservationKey](observe)
        : function stopUnobservedTranscript() {
            return undefined;
        };
}
