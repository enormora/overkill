import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';
import { subjectAssertion } from '../../test-support/assertion-reference-boundary.ts';
import type { EngineCaseBody } from '../../test-support/create-test-engine.ts';

import { createRoot, createTestCase, createTestPlan, execute } from '../engine/engine.entry-point.ts';

import { runWithTranscriptScope } from '../run/transcript-store.entry-point.ts';

import {
    createTranscript,
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

async function executeAssertionBody(
    body: (...parameters: Parameters<EngineCaseBody>) => void
): Promise<Awaited<ReturnType<typeof execute>>> {
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

const assertPassingExecution = defineCompositeAssertion({
    name: 'passing execution',
    assert(check, result: Awaited<ReturnType<typeof execute>>) {
        return check.group([ check.deepEqual(
            {
                failed: result.summary.failed,
                passed: result.summary.passed
            },
            {
                failed: 0,
                passed: 1
            }
        ) ]);
    }
});

const failingExecutionChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: Awaited<ReturnType<typeof execute>>
): CompositeAssertionReturn<'assert'> {
    return check.group([ check.deepEqual(
        {
            failed: result.summary.failed,
            passed: result.summary.passed
        },
        {
            failed: 1,
            passed: 0
        }
    ) ]);
};

function disposeTwice(disposable: DisposableHandle): void {
    disposable.dispose();
    disposable.dispose();
}

const assertResetTranscript = defineCompositeAssertion({
    name: 'reset transcript',
    assert(check, transcript: Transcript<StateEntry>) {
        return check.group([ check.equal(transcript.entries.length, 0), check.equal(transcript.entryCount, 0) ]);
    }
});

const assertKindOnlyFails = defineCompositeAssertion({
    name: 'kind only fails',
    async assert(check, transcript: Transcript<WarnEntry>) {
        return failingExecutionChecks(
            check.annotated('failing execution'),
            await executeAssertionBody(function containsKindOnly(testScope) {
                testScope.assert(subjectAssertion(transcriptUsage.contains), transcript, [ 'warn' ]);
            })
        );
    }
});

const assertPlainObjectFails = defineCompositeAssertion({
    name: 'plain object fails',
    async assert(check) {
        return failingExecutionChecks(
            check.annotated('failing execution'),
            await executeAssertionBody(function rejectsPlainObject(testScope) {
                testScope.assert(subjectAssertion(transcriptUsage.empty), { entries: [] });
            })
        );
    }
});

const assertEmptySequenceFails = defineCompositeAssertion({
    name: 'empty sequence fails',
    async assert(check, transcript: Transcript<WarnEntry>) {
        return failingExecutionChecks(
            check.annotated('failing execution'),
            await executeAssertionBody(function rejectsEmptySequence(testScope) {
                testScope.assert(
                    subjectAssertion(transcriptUsage.startsWith),
                    transcript,
                    [] as unknown as readonly [
                        TranscriptEntry,
                        ...TranscriptEntry[]
                    ]
                );
            })
        );
    }
});

function recordWarnTranscript(transcript: Transcript<WarnEntry>): void {
    transcript.record('warn', 'retrying', { attempt: 2, delay: 10 });
    transcript.record('warn', 'done', { attempt: 3 });
}

type LiveTranscriptEntriesEvidence = {
    readonly transcript: Transcript<StateEntry>;
    readonly entries: readonly StateEntry[];
};

const liveTranscriptEntries = defineCompositeAssertion({
    name: 'live transcript entries',
    assert(
        check,
        { transcript, entries }: LiveTranscriptEntriesEvidence
    ) {
        return check.group([
            check.equal(Object.isFrozen(transcript), true),
            check.equal(transcript.entries, entries),
            check.equal(transcript.firstEntry, entries[0]),
            check.equal(transcript.lastEntry, entries[0]),
            check.equal(transcript.nthEntry(0), entries[0]),
            check.equal(transcript.nthEntry(-1), null),
            check.equal(transcript.nthEntry(1.5), null)
        ]);
    }
});

export const testNode = suite('Interaction transcript', [
    test(
        'createTranscript() records live ordered entries',
        function (scope): ReturnType<EngineCaseBody> {
            const transcript = createTranscript<StateEntry>();
            const { entries } = transcript;

            transcript.record('state', 1);

            scope.assert(liveTranscriptEntries, { transcript, entries });

            scope.assert(subjectAssertion(transcriptUsage.exactly), transcript, [ [ 'state', 1 ] ]);

            transcript.reset();
            scope.assert(assertResetTranscript, transcript);

            return scope.assert.collect();
        }
    ),
    test(
        'transcript.sink() records through a test double with independent reset',
        function (scope): ReturnType<EngineCaseBody> {
            const transcript = createTranscript<WarnEntry>();
            const warn = transcript.sink('warn');

            warn('retrying', { attempt: 2 });

            scope.assert(
                defineCompositeAssertion({
                    name: 'transcript.sink() records through a test double with independent reset',
                    assert(check) {
                        return check.group([
                            check.equal(warn.callCount, 1),
                            check.deepEqual<unknown, unknown>(warn.firstCall?.arguments, [ 'retrying', { attempt: 2 } ])
                        ]);
                    }
                })
            );

            scope.assert(subjectAssertion(transcriptUsage.exactly), transcript, [
                [ 'warn', 'retrying', { attempt: 2 } ]
            ]);

            warn.reset();
            scope.assert(
                defineCompositeAssertion({
                    name: 'transcript.sink() records through a test double with independent reset',
                    assert(check) {
                        return check.group([ check.equal(warn.callCount, 0), check.equal(transcript.entryCount, 1) ]);
                    }
                })
            );

            transcript.reset();

            scope.assert.equal(transcript.entryCount, 0);

            return scope.assert.collect();
        }
    ),
    test(
        'recordSink() subscribes immediately and disposes sync cleanup once',
        function (scope): ReturnType<EngineCaseBody> {
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

            scope.assert(
                defineCompositeAssertion({
                    name: 'recordSink() subscribes immediately and disposes sync cleanup once',
                    assert(check) {
                        return check.group([
                            check.equal(Object.isFrozen(states), true),
                            check.equal(cleanupCount, 1),
                            check.deepEqual(states.entries, [
                                [ 'state', 1 ],
                                [ 'state', 2 ]
                            ])
                        ]);
                    }
                })
            );

            return scope.assert.collect();
        }
    ),
    test(
        'recordAsyncSink() subscribes immediately and disposes async cleanup once',
        async function (scope) {
            let cleanupCount = 0;
            const states = recordAsyncSink<StateEntry>(function subscribe(record) {
                record('state', 1);

                return async function cleanup() {
                    cleanupCount += 1;
                };
            });

            await states.asyncDispose();
            await states.asyncDispose();

            scope.assert(
                defineCompositeAssertion({
                    name: 'recordAsyncSink() subscribes immediately and disposes async cleanup once',
                    assert(check) {
                        return check.group([
                            check.equal(Object.isFrozen(states), true),
                            check.equal(cleanupCount, 1),
                            check.deepEqual(states.entries, [ [ 'state', 1 ] ])
                        ]);
                    }
                })
            );

            return scope.assert.collect();
        }
    ),
    test('subscription recorders reject invalid factories and cleanup shapes', async function (scope) {
        scope.assert(
            defineCompositeAssertion({
                name: 'subscription recorders reject invalid factories and cleanup shapes',
                assert(check) {
                    return check.group([
                        check.throws(function createSyncSinkWithoutFactory() {
                            recordSink(undefined as unknown as (record: (...entry: StateEntry) => void) => () => void);
                        }, { message: 'recordSink() requires a subscription factory function.' }),
                        check.throws(function createSyncSinkWithoutCleanup() {
                            recordSink(function subscribe() {
                                return null as unknown as () => void;
                            });
                        }, { message: 'recordSink() subscription factory must return a cleanup function.' })
                    ]);
                }
            })
        );

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
    }),
    test('transcriptUsage asserts exact and partial transcript entries', async function (scope) {
        const transcript = createTranscript<WarnEntry>();

        recordWarnTranscript(transcript);
        scope.assert(subjectAssertion(transcriptUsage.exactly), transcript, [
            [ 'warn', 'retrying', { attempt: 2, delay: 10 } ],
            [ 'warn', 'done', { attempt: 3 } ]
        ]);

        scope.assert(subjectAssertion(transcriptUsage.contains), transcript, [ 'warn', 'retrying', { attempt: 2 } ]);

        scope.assert(subjectAssertion(transcriptUsage.startsWith), transcript, [ [ 'warn', 'retrying', {
            attempt: 2
        } ] ]);

        scope.assert(subjectAssertion(transcriptUsage.inOrder), transcript, [ [ 'warn', 'retrying', { attempt: 2 } ], [
            'warn',
            'done',
            { attempt: 3 }
        ] ]);

        await scope.assert(assertKindOnlyFails, transcript);
        await scope.assert(assertPlainObjectFails);
        await scope.assert(assertEmptySequenceFails, transcript);

        return scope.assert.collect();
    }),
    test('transcriptUsage snapshots entries when the assertion is recorded', async function (scope) {
        const result = await executeAssertionBody(function assertBeforeLaterRecord(testScope) {
            const transcript = createTranscript();

            transcript.record('state', 1);

            testScope.assert(subjectAssertion(transcriptUsage.exactly), transcript, [ [ 'state', 1 ] ]);
            transcript.record('state', 2);
        });

        scope.assert(assertPassingExecution, result);

        return scope.assert.collect();
    }),
    test('transcripts show the active case or the full resource lifetime', async function (scope) {
        const transcript = createTranscript<StateEntry>();
        const firstCase = {};
        const secondCase = {};

        transcript.record('state', 0);
        await runWithTranscriptScope(firstCase, async function recordFirstCase() {
            transcript.record('state', 1);
            scope.assert.deepEqual(transcript.entries, [ [ 'state', 1 ] ]);
        });
        await runWithTranscriptScope(secondCase, async function recordSecondCase() {
            transcript.record('state', 2);
            scope.assert.deepEqual(transcript.entries, [ [ 'state', 2 ] ]);
        });
        await runWithTranscriptScope(null, async function assertLifetimeEntries() {
            scope.assert.deepEqual(transcript.entries, [
                [ 'state', 0 ],
                [ 'state', 1 ],
                [ 'state', 2 ]
            ]);
        });

        return scope.assert.collect();
    })
]);
