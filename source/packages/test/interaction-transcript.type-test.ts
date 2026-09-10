import { describe, expect, test } from 'tstyche';
import type { TestScopeAssertContext } from '../engine/engine.entry-point.ts';
import {
    createTranscript,
    recordAsyncSink,
    recordSink,
    transcriptUsage,
    type AsyncDisposableTranscript,
    type DisposableTranscript,
    type Transcript,
    type TranscriptEntry,
    type TranscriptUsageAssertions
} from './test.entry-point.ts';

type State = {
    readonly count: number;
};
type StateEntry = readonly [kind: 'state', value: State];
type RootTranscriptTypes = {
    readonly asyncDisposableTranscript: AsyncDisposableTranscript<StateEntry>;
    readonly disposableTranscript: DisposableTranscript<StateEntry>;
    readonly transcript: Transcript<StateEntry>;
    readonly transcriptEntry: TranscriptEntry;
    readonly transcriptUsageAssertions: TranscriptUsageAssertions;
};

declare const rootAssert: TestScopeAssertContext;

describe('@overkill-dev/test interaction transcripts', function () {
    test('exposes transcript authoring types from the root facade', function () {
        expect<RootTranscriptTypes>().type.toBe<{
            readonly asyncDisposableTranscript: AsyncDisposableTranscript<StateEntry>;
            readonly disposableTranscript: DisposableTranscript<StateEntry>;
            readonly transcript: Transcript<StateEntry>;
            readonly transcriptEntry: TranscriptEntry;
            readonly transcriptUsageAssertions: TranscriptUsageAssertions;
        }>();
    });

    test('creates typed interaction transcript recorders', function () {
        const transcript = createTranscript<StateEntry>();
        const sink = transcript.sink('state');
        const subscription = recordSink<StateEntry>(function subscribe(record) {
            record('state', { count: 1 });

            return function cleanup() {
                return null;
            };
        });
        const asyncSubscription = recordAsyncSink<StateEntry>(function subscribe(record) {
            record('state', { count: 1 });

            return async function cleanup() {
                await Promise.resolve();
            };
        });

        transcript.record('state', { count: 1 });

        expect(transcript).type.toBe<Transcript<StateEntry>>();
        expect(sink).type.toBeCallableWith({ count: 1 });
        expect(subscription).type.toBe<DisposableTranscript<StateEntry>>();
        expect(asyncSubscription).type.toBe<AsyncDisposableTranscript<StateEntry>>();
    });

    test('asserts typed interaction transcript usage', function () {
        const transcript = createTranscript<StateEntry>();

        transcript.record('state', { count: 1 });

        expect(transcript.record).type.not.toBeCallableWith('other', { count: 1 });
        expect(transcript.record).type.not.toBeCallableWith('state', { value: 1 });
        expect(rootAssert).type.toBeCallableWith(transcriptUsage.empty, transcript);
        expect(rootAssert).type.toBeCallableWith(transcriptUsage.exactly, transcript, [ [ 'state', { count: 1 } ] ]);
    });
});
