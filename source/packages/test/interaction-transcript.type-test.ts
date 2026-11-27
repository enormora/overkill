import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { TestScopeAssertContext } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('@overkill-dev/test interaction transcripts', [
    test('exposes transcript authoring types from the root facade', function (typeScope) {
        typeScope.assert(sameType<
            IsEqual<RootTranscriptTypes, {
                readonly asyncDisposableTranscript: AsyncDisposableTranscript<StateEntry>;
                readonly disposableTranscript: DisposableTranscript<StateEntry>;
                readonly transcript: Transcript<StateEntry>;
                readonly transcriptEntry: TranscriptEntry;
                readonly transcriptUsageAssertions: TranscriptUsageAssertions;
            }>,
            true
        >());
        return typeScope.assert.collect();
    }),
    test('creates typed interaction transcript recorders', function (typeScope) {
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

        typeScope.assert(sameType.withActual<true>(), isEqualTo<Transcript<StateEntry>>()(transcript));
        typeScope.assert(acceptsCall, () => sink({ count: 1 }));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<DisposableTranscript<StateEntry>>()(subscription));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<AsyncDisposableTranscript<StateEntry>>()(asyncSubscription)
        );
        return typeScope.assert.collect();
    }),
    test('asserts typed interaction transcript usage', function (typeScope) {
        const transcript = createTranscript<StateEntry>();

        transcript.record('state', { count: 1 });

        typeScope.assert(rejectsCall('argument-type'), () => transcript.record('other', { count: 1 }));
        typeScope.assert(rejectsCall('argument-type'), () => transcript.record('state', { value: 1 }));
        typeScope.assert(acceptsCall, () => rootAssert(transcriptUsage.empty, transcript));
        typeScope.assert(
            acceptsCall,
            () => rootAssert(transcriptUsage.exactly, transcript, [ [ 'state', { count: 1 } ] ])
        );
        return typeScope.assert.collect();
    })
]);
