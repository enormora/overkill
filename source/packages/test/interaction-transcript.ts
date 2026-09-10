import {
    defineCompositeAssertion,
    type CompositeAssertionReference,
    type CompositeAssertionReturn,
    type CompositeCheckBuilder
} from '../assert/assert.entry-point.ts';
import {
    testDouble,
    type TestDouble
} from '../doubles/doubles.entry-point.ts';
import { comparePartially } from '../../compare/raw-comparison.ts';

const transcriptIdentity: unique symbol = Symbol('OverkillTranscript');
const symbolWithDisposal: SymbolConstructorWithDisposal = Symbol;
const disposeSymbol: typeof Symbol.dispose = symbolWithDisposal.dispose;
const asyncDisposeSymbol: typeof Symbol.asyncDispose = symbolWithDisposal.asyncDispose;

type SymbolConstructorWithDisposal = typeof Symbol & {
    readonly asyncDispose: typeof Symbol.asyncDispose;
    readonly dispose: typeof Symbol.dispose;
};
type EntryForKind<
    Entry extends TranscriptEntry,
    Kind extends Entry[0]
> = Extract<Entry, readonly [Kind, ...readonly unknown[]]>;
type TranscriptSink = (...parameters: readonly unknown[]) => undefined;
type SinkKind<
    Entry extends TranscriptEntry,
    Kind extends Entry[0]
> = EntryForKind<Entry, Kind>[0];
type AssertionCheck = CompositeCheckBuilder<'assert'>;
type AssertionResult = CompositeAssertionReturn<'assert'>;
type TranscriptUsageReference<Arguments extends readonly unknown[]> = CompositeAssertionReference<
    Arguments,
    AssertionResult
>;

export type TranscriptEntry = readonly [kind: string, ...values: readonly unknown[]];

export type Transcript<Entry extends TranscriptEntry = TranscriptEntry> = {
    readonly entryCount: number;
    readonly entries: readonly Entry[];
    readonly firstEntry: Entry | null;
    readonly lastEntry: Entry | null;
    readonly nthEntry: (index: number) => Entry | null;
    readonly record: (...entry: Entry) => void;
    readonly reset: () => void;
    readonly sink: <Kind extends Entry[0]>(kind: SinkKind<Entry, Kind>) => TestDouble<TranscriptSink>;
};

export type DisposableTranscript<Entry extends TranscriptEntry = TranscriptEntry> = Disposable & Transcript<Entry> & {
    readonly dispose: () => void;
};

type AsyncTranscript<Entry extends TranscriptEntry> = Transcript<Entry> & {
    readonly asyncDispose: () => Promise<void>;
};

type AsyncDisposableEntry<Entry extends TranscriptEntry> = AsyncDisposable & AsyncTranscript<Entry>;

export type AsyncDisposableTranscript<Entry extends TranscriptEntry = TranscriptEntry> = AsyncDisposableEntry<Entry>;

export type TranscriptUsageAssertions = {
    readonly contains: TranscriptUsageReference<readonly [transcript: unknown, entry: TranscriptEntry]>;
    readonly empty: TranscriptUsageReference<readonly [transcript: unknown]>;
    readonly exactly: TranscriptUsageReference<readonly [transcript: unknown, entries: readonly TranscriptEntry[]]>;
    readonly inOrder: TranscriptUsageReference<
        readonly [transcript: unknown, entries: readonly [TranscriptEntry, ...(readonly TranscriptEntry[])]]
    >;
    readonly startsWith: TranscriptUsageReference<
        readonly [transcript: unknown, entries: readonly [TranscriptEntry, ...(readonly TranscriptEntry[])]]
    >;
};

type RuntimeTranscript = Transcript & {
    readonly [transcriptIdentity]: true;
};

type TranscriptInspection = {
    readonly entries: readonly TranscriptEntry[];
    readonly valid: true;
} | {
    readonly failure: AssertionResult;
    readonly valid: false;
};

function validIndex(index: number): boolean {
    return Number.isSafeInteger(index) && index >= 0;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';
}

function isTranscript(value: unknown): value is RuntimeTranscript {
    return typeof value === 'object' && value !== null &&
        Object.hasOwn(value, transcriptIdentity) &&
        Reflect.get(value, transcriptIdentity) === true;
}

function entriesSnapshot(transcript: RuntimeTranscript): readonly TranscriptEntry[] {
    return transcript.entries.map(function copyEntry(entry) {
        const [ kind, ...values ] = entry;

        return [ kind, ...values ];
    });
}

function invalidTranscriptFailure(check: AssertionCheck): AssertionResult {
    return check.fromThrowable('interaction transcript', function expectedInteractionTranscript() {
        throw new TypeError('Expected an Overkill interaction transcript.');
    });
}

function inspectTranscript(check: AssertionCheck, subject: unknown): TranscriptInspection {
    return isTranscript(subject)
        ? { entries: entriesSnapshot(subject), valid: true }
        : { failure: invalidTranscriptFailure(check), valid: false };
}

function entryMatches(actual: TranscriptEntry, expected: TranscriptEntry): boolean {
    return actual.length === expected.length &&
        expected.every(function valueMatches(expectedValue, index) {
            return comparePartially(actual[index], expectedValue);
        });
}

function containsEntry(entries: readonly TranscriptEntry[], expected: TranscriptEntry): boolean {
    return entries.some(function matchesEntry(entry) {
        return entryMatches(entry, expected);
    });
}

function startsWithEntries(entries: readonly TranscriptEntry[], expected: readonly TranscriptEntry[]): boolean {
    return expected.length <= entries.length &&
        expected.every(function prefixEntryMatches(expectedEntry, index) {
            const actualEntry = entries[index];

            return actualEntry !== undefined && entryMatches(actualEntry, expectedEntry);
        });
}

function containsEntriesInOrder(entries: readonly TranscriptEntry[], expected: readonly TranscriptEntry[]): boolean {
    let nextExpectedIndex = 0;

    for (const entry of entries) {
        const expectedEntry = expected[nextExpectedIndex];

        if (expectedEntry !== undefined && entryMatches(entry, expectedEntry)) {
            nextExpectedIndex += 1;
        }
    }

    return nextExpectedIndex === expected.length;
}

function emptySequenceAssertion(check: AssertionCheck, entries: readonly TranscriptEntry[]): AssertionResult | null {
    return entries.length === 0
        ? check.fromThrowable('expected transcript sequence', function expectedTranscriptSequence() {
            throw new TypeError('Expected transcript sequence to contain at least one entry.');
        })
        : null;
}

function transcriptContainsAssertion(
    check: AssertionCheck,
    entries: readonly TranscriptEntry[],
    expected: TranscriptEntry
): AssertionResult {
    if (containsEntry(entries, expected)) {
        return check.annotated('matching transcript entry').true(true);
    }

    return check.annotated('matching transcript entry').true(false);
}

function transcriptStartsWithAssertion(
    check: AssertionCheck,
    entries: readonly TranscriptEntry[],
    expected: readonly TranscriptEntry[]
): AssertionResult {
    const sequenceFailure = emptySequenceAssertion(check, expected);

    if (sequenceFailure !== null) {
        return sequenceFailure;
    }

    return check.annotated('transcript prefix').true(startsWithEntries(entries, expected));
}

function transcriptInOrderAssertion(
    check: AssertionCheck,
    entries: readonly TranscriptEntry[],
    expected: readonly TranscriptEntry[]
): AssertionResult {
    const sequenceFailure = emptySequenceAssertion(check, expected);

    if (sequenceFailure !== null) {
        return sequenceFailure;
    }

    return check.annotated('transcript ordered entries').true(containsEntriesInOrder(entries, expected));
}

function freezeTranscript<Entry extends TranscriptEntry, Subject extends Transcript<Entry>>(subject: Subject): Subject {
    Object.defineProperty(subject, transcriptIdentity, {
        enumerable: false,
        value: true
    });

    return Object.freeze(subject);
}

function createTranscriptBase<Entry extends TranscriptEntry>(): Transcript<Entry> {
    const entries: Entry[] = [];

    const transcript: Transcript<Entry> = {
        get entries() {
            return entries;
        },
        get entryCount() {
            return entries.length;
        },
        get firstEntry() {
            return entries[0] ?? null;
        },
        get lastEntry() {
            return entries.at(-1) ?? null;
        },
        nthEntry(index) {
            return validIndex(index) ? entries[index] ?? null : null;
        },
        record(...entry) {
            entries.push(entry);
        },
        reset() {
            entries.length = 0;
        },
        sink<Kind extends Entry[0]>(kind: SinkKind<Entry, Kind>) {
            return testDouble<TranscriptSink>({
                answer(invocation) {
                    Reflect.apply(transcript.record, transcript, [ kind, ...invocation.arguments ]);
                    return undefined;
                }
            });
        }
    };

    return freezeTranscript<Entry, typeof transcript>(transcript);
}

function disposableTranscript<Entry extends TranscriptEntry>(
    transcript: Transcript<Entry>,
    dispose: () => void
): DisposableTranscript<Entry> {
    const subject: DisposableTranscript<Entry> = {
        [disposeSymbol]: dispose,
        dispose,
        get entries() {
            return transcript.entries;
        },
        get entryCount() {
            return transcript.entryCount;
        },
        get firstEntry() {
            return transcript.firstEntry;
        },
        get lastEntry() {
            return transcript.lastEntry;
        },
        nthEntry(index) {
            return transcript.nthEntry(index);
        },
        record(...entry) {
            transcript.record(...entry);
        },
        reset() {
            transcript.reset();
        },
        sink(kind) {
            return transcript.sink(kind);
        }
    };

    return freezeTranscript<Entry, typeof subject>(subject);
}

function asyncDisposableTranscript<Entry extends TranscriptEntry>(
    transcript: Transcript<Entry>,
    asyncDispose: () => Promise<void>
): AsyncDisposableTranscript<Entry> {
    const subject: AsyncDisposableTranscript<Entry> = {
        [asyncDisposeSymbol]: asyncDispose,
        asyncDispose,
        get entries() {
            return transcript.entries;
        },
        get entryCount() {
            return transcript.entryCount;
        },
        get firstEntry() {
            return transcript.firstEntry;
        },
        get lastEntry() {
            return transcript.lastEntry;
        },
        nthEntry(index) {
            return transcript.nthEntry(index);
        },
        record(...entry) {
            transcript.record(...entry);
        },
        reset() {
            transcript.reset();
        },
        sink(kind) {
            return transcript.sink(kind);
        }
    };

    return freezeTranscript<Entry, typeof subject>(subject);
}

export const createTranscript: <Entry extends TranscriptEntry = TranscriptEntry>() => Transcript<Entry> =
    createTranscriptBase;

export function recordSink<Entry extends TranscriptEntry = TranscriptEntry>(
    subscribe: (record: (...entry: Entry) => void) => () => unknown
): DisposableTranscript<Entry> {
    if (typeof subscribe !== 'function') {
        throw new TypeError('recordSink() requires a subscription factory function.');
    }

    const transcript = createTranscriptBase<Entry>();
    const cleanup = subscribe(transcript.record);

    if (typeof cleanup !== 'function') {
        throw new TypeError('recordSink() subscription factory must return a cleanup function.');
    }

    let disposed = false;
    const dispose = function disposeTranscriptSink(): void {
        if (disposed) {
            return;
        }

        disposed = true;
        const result = cleanup();

        if (isPromiseLike(result)) {
            throw new TypeError('recordSink() cleanup returned a promise. Use recordAsyncSink() for async cleanup.');
        }
    };

    return disposableTranscript(transcript, dispose);
}

export function recordAsyncSink<Entry extends TranscriptEntry = TranscriptEntry>(
    subscribe: (record: (...entry: Entry) => void) => () => Promise<void>
): AsyncDisposableTranscript<Entry> {
    if (typeof subscribe !== 'function') {
        throw new TypeError('recordAsyncSink() requires a subscription factory function.');
    }

    const transcript = createTranscriptBase<Entry>();
    const cleanup = subscribe(transcript.record);

    if (typeof cleanup !== 'function') {
        throw new TypeError('recordAsyncSink() subscription factory must return a cleanup function.');
    }

    let disposed = false;
    const asyncDispose = async function disposeTranscriptSinkAsync(): Promise<void> {
        if (disposed) {
            return;
        }

        disposed = true;
        const result = cleanup();

        if (!isPromiseLike(result)) {
            throw new TypeError('recordAsyncSink() cleanup must return a promise. Use recordSink() for sync cleanup.');
        }

        await result;
    };

    return asyncDisposableTranscript(transcript, asyncDispose);
}

export const transcriptUsage: TranscriptUsageAssertions = Object.freeze({
    contains: defineCompositeAssertion<readonly [transcript: unknown, entry: TranscriptEntry], AssertionResult>({
        assert(check, transcript, entry) {
            const inspected = inspectTranscript(check, transcript);

            return inspected.valid
                ? transcriptContainsAssertion(check, inspected.entries, entry)
                : inspected.failure;
        },
        formatSummary() {
            return 'Expected transcript to contain entry.';
        },
        name: 'transcriptUsage.contains'
    }),
    empty: defineCompositeAssertion<readonly [transcript: unknown], AssertionResult>({
        assert(check, transcript) {
            const inspected = inspectTranscript(check, transcript);

            return inspected.valid
                ? check.annotated('transcript entry count').equal(inspected.entries.length, 0)
                : inspected.failure;
        },
        formatSummary() {
            return 'Expected transcript to be empty.';
        },
        name: 'transcriptUsage.empty'
    }),
    exactly: defineCompositeAssertion<
        readonly [transcript: unknown, entries: readonly TranscriptEntry[]],
        AssertionResult
    >({
        assert(check, transcript, entries) {
            const inspected = inspectTranscript(check, transcript);

            return inspected.valid
                ? check.annotated('transcript entries').deepEqual(inspected.entries, entries)
                : inspected.failure;
        },
        formatSummary() {
            return 'Expected transcript entries to match exactly.';
        },
        name: 'transcriptUsage.exactly'
    }),
    inOrder: defineCompositeAssertion<
        readonly [transcript: unknown, entries: readonly [TranscriptEntry, ...TranscriptEntry[]]],
        AssertionResult
    >({
        assert(check, transcript, entries) {
            const inspected = inspectTranscript(check, transcript);

            return inspected.valid
                ? transcriptInOrderAssertion(check, inspected.entries, entries)
                : inspected.failure;
        },
        formatSummary() {
            return 'Expected transcript to contain entries in order.';
        },
        name: 'transcriptUsage.inOrder'
    }),
    startsWith: defineCompositeAssertion<
        readonly [transcript: unknown, entries: readonly [TranscriptEntry, ...TranscriptEntry[]]],
        AssertionResult
    >({
        assert(check, transcript, entries) {
            const inspected = inspectTranscript(check, transcript);

            return inspected.valid
                ? transcriptStartsWithAssertion(check, inspected.entries, entries)
                : inspected.failure;
        },
        formatSummary() {
            return 'Expected transcript to start with entries.';
        },
        name: 'transcriptUsage.startsWith'
    })
});
