import { AsyncLocalStorage } from 'node:async_hooks';

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

const activeTranscriptScope = new AsyncLocalStorage<TranscriptScope>();
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
    scope: TranscriptScope,
    run: () => Promise<Value>
): Promise<Value> {
    return await activeTranscriptScope.run(scope, run);
}

function brandedView<Entry extends TranscriptEntry>(currentEntries: () => readonly Entry[]): TranscriptView<Entry> {
    const view: TranscriptView<Entry> = {
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
        nthEntry(index) {
            return validIndex(index) ? currentEntries()[index] ?? null : null;
        }
    };

    return brandTranscriptView(view);
}

export function createTranscriptStore<Entry extends TranscriptEntry>(): TranscriptStore<Entry> {
    const entries: Entry[] = [];
    let scopedEntries = new WeakMap<TranscriptScope, Entry[]>();

    function recordInScope(scope: TranscriptScope | null, entry: Entry): void {
        entries.push(entry);
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
        view: brandedView(currentEntries)
    });
}

export function isTranscriptView(value: unknown): value is RuntimeTranscriptView {
    return typeof value === 'object' && value !== null && Reflect.get(value, transcriptIdentity) === true;
}
