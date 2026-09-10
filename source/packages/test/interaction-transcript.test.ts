import {
    createRoot,
    createSuite,
    createTestCase,
    createTestPlan,
    execute,
    type TestBody,
    type TestScope,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import {
    createTranscript,
    doubleUsage,
    recordAsyncSink,
    recordSink,
    transcriptUsage,
    type Transcript,
    type TranscriptEntry
} from './test.entry-point.ts';

type StateEntry = readonly [kind: 'state', value: number];
type WarnEntry = readonly [
    kind: 'warn',
    message: string,
    fields: { readonly attempt: number; readonly delay?: number; }
];
type DisposableHandle = {
    readonly dispose: () => void;
};

async function executeAssertionBody(body: (scope: TestScope) => void): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        children: [
            createTestCase({
                body(scope) {
                    body(scope);

                    return scope.assert.collect();
                },
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: {},
                controls: {},
                title: 'assertion case'
            })
        ],
        annotations: {},
        controls: {},
        title: 'root'
    })));
}

function assertPassingExecution(scope: OverkillScope, result: Awaited<ReturnType<typeof execute>>): void {
    scope.assert.deepEqual(
        {
            failed: result.summary.failed,
            passed: result.summary.passed
        },
        {
            failed: 0,
            passed: 1
        }
    );
}

function assertFailingExecution(scope: OverkillScope, result: Awaited<ReturnType<typeof execute>>): void {
    scope.assert.deepEqual(
        {
            failed: result.summary.failed,
            passed: result.summary.passed
        },
        {
            failed: 1,
            passed: 0
        }
    );
}

function disposeTwice(disposable: DisposableHandle): void {
    disposable.dispose();
    disposable.dispose();
}

function assertRecordedFirstState(
    scope: OverkillScope,
    transcript: Transcript<StateEntry>,
    entries: readonly StateEntry[]
): void {
    scope.assert.equal(Object.isFrozen(transcript), true);
    scope.assert.equal(transcript.entries, entries);
    scope.assert.equal(transcript.firstEntry, entries[0]);
    scope.assert.equal(transcript.lastEntry, entries[0]);
    scope.assert.equal(transcript.nthEntry(0), entries[0]);
    scope.assert.equal(transcript.nthEntry(-1), null);
    scope.assert.equal(transcript.nthEntry(1.5), null);
    scope.assert(transcriptUsage.exactly, transcript, [ [ 'state', 1 ] ]);
}

function assertResetTranscript(
    scope: OverkillScope,
    transcript: Transcript<StateEntry>
): void {
    scope.assert.equal(transcript.entries.length, 0);
    scope.assert.equal(transcript.entryCount, 0);
}

function assertWarnSinkRecorded(
    scope: OverkillScope,
    transcript: Transcript<WarnEntry>,
    warn: (...parameters: readonly unknown[]) => undefined
): void {
    scope.assert(doubleUsage.calledOnceWith, warn, [ 'retrying', { attempt: 2 } ]);
    scope.assert(transcriptUsage.exactly, transcript, [
        [ 'warn', 'retrying', { attempt: 2 } ]
    ]);
}

async function assertKindOnlyFails(scope: OverkillScope, transcript: Transcript<WarnEntry>): Promise<void> {
    assertFailingExecution(
        scope,
        await executeAssertionBody(function containsKindOnly(testScope) {
            testScope.assert(transcriptUsage.contains, transcript, [ 'warn' ]);
        })
    );
}

async function assertPlainObjectFails(scope: OverkillScope): Promise<void> {
    assertFailingExecution(
        scope,
        await executeAssertionBody(function rejectsPlainObject(testScope) {
            testScope.assert(transcriptUsage.empty, { entries: [] });
        })
    );
}

async function assertEmptySequenceFails(
    scope: OverkillScope,
    transcript: Transcript<WarnEntry>
): Promise<void> {
    assertFailingExecution(
        scope,
        await executeAssertionBody(function rejectsEmptySequence(testScope) {
            testScope.assert(
                transcriptUsage.startsWith,
                transcript,
                [] as unknown as readonly [
                    TranscriptEntry,
                    ...TranscriptEntry[]
                ]
            );
        })
    );
}

function recordWarnTranscript(transcript: Transcript<WarnEntry>): void {
    transcript.record('warn', 'retrying', { attempt: 2, delay: 10 });
    transcript.record('warn', 'done', { attempt: 3 });
}

function assertWarnTranscriptUsage(
    scope: OverkillScope,
    transcript: Transcript<WarnEntry>,
    prefix: readonly [TranscriptEntry],
    ordered: readonly [TranscriptEntry, TranscriptEntry]
): void {
    scope.assert(transcriptUsage.exactly, transcript, [
        [ 'warn', 'retrying', { attempt: 2, delay: 10 } ],
        [ 'warn', 'done', { attempt: 3 } ]
    ]);
    scope.assert(transcriptUsage.contains, transcript, [ 'warn', 'retrying', { attempt: 2 } ]);
    scope.assert(transcriptUsage.startsWith, transcript, prefix);
    scope.assert(transcriptUsage.inOrder, transcript, ordered);
}

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope: OverkillScope): ReturnType<TestBody> {
                const transcript = createTranscript<StateEntry>();
                const { entries } = transcript;

                transcript.record('state', 1);
                assertRecordedFirstState(scope, transcript, entries);

                transcript.reset();
                assertResetTranscript(scope, transcript);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'createTranscript() records live ordered entries'
        }),
        createTestCase({
            body(scope: OverkillScope): ReturnType<TestBody> {
                const transcript = createTranscript<WarnEntry>();
                const warn = transcript.sink('warn');

                warn('retrying', { attempt: 2 });
                assertWarnSinkRecorded(scope, transcript, warn);

                warn.reset();
                scope.assert.equal(warn.callCount, 0);
                scope.assert.equal(transcript.entryCount, 1);

                transcript.reset();

                scope.assert.equal(transcript.entryCount, 0);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'transcript.sink() records through a test double with independent reset'
        }),
        createTestCase({
            body(scope: OverkillScope): ReturnType<TestBody> {
                let cleanupCount = 0;
                let recordState: (value: number) => void = function missingRecordState() {
                    throw new Error('recordSink() did not subscribe.');
                };
                const states = recordSink<StateEntry>(function subscribe(record) {
                    recordState = function recordRetainedState(value) {
                        record('state', value);
                    };

                    return function cleanup() {
                        cleanupCount += 1;
                    };
                });

                recordState(1);
                disposeTwice(states);
                recordState(2);

                scope.assert.equal(Object.isFrozen(states), true);
                scope.assert.equal(cleanupCount, 1);
                scope.assert.deepEqual(states.entries, [
                    [ 'state', 1 ],
                    [ 'state', 2 ]
                ]);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'recordSink() subscribes immediately and disposes sync cleanup once'
        }),
        createTestCase({
            async body(scope: OverkillScope) {
                let cleanupCount = 0;
                const states = recordAsyncSink<StateEntry>(function subscribe(record) {
                    record('state', 1);

                    return async function cleanup() {
                        cleanupCount += 1;
                    };
                });

                await states.asyncDispose();
                await states.asyncDispose();

                scope.assert.equal(Object.isFrozen(states), true);
                scope.assert.equal(cleanupCount, 1);
                scope.assert.deepEqual(states.entries, [ [ 'state', 1 ] ]);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'recordAsyncSink() subscribes immediately and disposes async cleanup once'
        }),
        createTestCase({
            async body(scope: OverkillScope) {
                scope.assert.throws(function createSyncSinkWithoutFactory() {
                    recordSink(undefined as unknown as (record: (...entry: StateEntry) => void) => () => void);
                }, { message: 'recordSink() requires a subscription factory function.' });
                scope.assert.throws(function createSyncSinkWithoutCleanup() {
                    recordSink(function subscribe() {
                        return null as unknown as () => void;
                    });
                }, { message: 'recordSink() subscription factory must return a cleanup function.' });

                const syncSink = recordSink(function subscribe() {
                    return async function cleanup() {
                        await Promise.resolve();
                    };
                });

                scope.assert.throws(function disposeSyncSinkWithAsyncCleanup() {
                    syncSink.dispose();
                }, { message: 'recordSink() cleanup returned a promise. Use recordAsyncSink() for async cleanup.' });

                const asyncSink = recordAsyncSink(function subscribe() {
                    return function cleanup() {
                        return null;
                    } as unknown as () => Promise<void>;
                });

                await scope.assert.rejects(async function disposeAsyncSinkWithSyncCleanup() {
                    await asyncSink.asyncDispose();
                }, { message: 'recordAsyncSink() cleanup must return a promise. Use recordSink() for sync cleanup.' });

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'subscription recorders reject invalid factories and cleanup shapes'
        }),
        createTestCase({
            async body(scope: OverkillScope) {
                const transcript = createTranscript<WarnEntry>();
                const prefix: readonly [TranscriptEntry] = [
                    [ 'warn', 'retrying', { attempt: 2 } ]
                ];
                const ordered: readonly [TranscriptEntry, TranscriptEntry] = [
                    [ 'warn', 'retrying', { attempt: 2 } ],
                    [ 'warn', 'done', { attempt: 3 } ]
                ];

                recordWarnTranscript(transcript);
                assertWarnTranscriptUsage(scope, transcript, prefix, ordered);

                await assertKindOnlyFails(scope, transcript);
                await assertPlainObjectFails(scope);
                await assertEmptySequenceFails(scope, transcript);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'transcriptUsage asserts exact and partial transcript entries'
        }),
        createTestCase({
            async body(scope: OverkillScope) {
                const result = await executeAssertionBody(function assertBeforeLaterRecord(testScope) {
                    const transcript = createTranscript();

                    transcript.record('state', 1);
                    testScope.assert(transcriptUsage.exactly, transcript, [ [ 'state', 1 ] ]);
                    transcript.record('state', 2);
                });

                assertPassingExecution(scope, result);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'transcriptUsage snapshots entries when the assertion is recorded'
        })
    ],
    definitionLocations: [ { kind: 'unknown' } ],
    annotations: {},
    controls: {},
    title: 'source/packages/test/interaction-transcript.test.ts'
});
