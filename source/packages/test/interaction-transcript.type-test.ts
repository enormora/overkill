import type { IsEqual } from 'type-fest';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { TestScopeAssertContext } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
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

export const testNode = suite('Typed interaction transcripts', [
    test('exposes transcript authoring types from the root facade', function (scope) {
        scope.assert(sameType<
            IsEqual<RootTranscriptTypes, {
                readonly asyncDisposableTranscript: AsyncDisposableTranscript<StateEntry>;
                readonly disposableTranscript: DisposableTranscript<StateEntry>;
                readonly transcript: Transcript<StateEntry>;
                readonly transcriptEntry: TranscriptEntry;
                readonly transcriptUsageAssertions: TranscriptUsageAssertions;
            }>,
            true
        >());
        return scope.assert.collect();
    }),
    test('creates typed interaction transcript recorders', function (scope) {
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

        scope.assert(sameType.withActual<true>(), isEqualTo<Transcript<StateEntry>>()(transcript));
        scope.assert(acceptsCall, function () {
            sink({ count: 1 });
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<DisposableTranscript<StateEntry>>()(subscription));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<AsyncDisposableTranscript<StateEntry>>()(asyncSubscription)
        );
        return scope.assert.collect();
    }),
    test('asserts typed interaction transcript usage', function (scope) {
        const transcript = createTranscript<StateEntry>();

        transcript.record('state', { count: 1 });

        scope.assert(rejectsCall('argument-type'), function () {
            transcript.record('other', { count: 1 });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            transcript.record('state', { value: 1 });
        });
        scope.assert(acceptsCall, function () {
            rootAssert(transcriptUsage.empty, transcript);
        });
        scope.assert(
            acceptsCall,
            function () {
                rootAssert(transcriptUsage.exactly, transcript, [ [ 'state', { count: 1 } ] ]);
            }
        );
        return scope.assert.collect();
    })
]);
