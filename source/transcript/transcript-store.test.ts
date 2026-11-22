import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';

import {
    captureErrorHttpTranscript,
    createHttpTranscriptRecorder,
    emptyTranscriptView,
    httpTranscriptBodyByteLimit,
    recordedHttpBody,
    recordedHttpError,
    type TranscriptCaptureErrorEntry,
    type TranscriptView
} from './http-transcript.ts';
import { createTranscriptStore, isTranscriptView, runWithTranscriptScope } from './transcript-store.ts';

const textEncoder = new TextEncoder();
const nonErrorCapture: TranscriptCaptureErrorEntry = [
    'capture-error',
    { message: 'broken', source: 'custom' }
];

const recordedBodiesChecks = function (check: CompositeCheckBuilder<'assert'>): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.deepEqual(recordedHttpBody(null), { kind: 'absent' }),
        check.deepEqual(recordedHttpBody(new Uint8Array()), { kind: 'absent' }),
        check.deepEqual(recordedHttpBody(textEncoder.encode('body')), {
            bytes: textEncoder.encode('body'),
            kind: 'complete'
        }),
        check.deepEqual(
            recordedHttpBody(new Uint8Array(httpTranscriptBodyByteLimit + 1)),
            {
                bytes: new Uint8Array(httpTranscriptBodyByteLimit),
                kind: 'truncated',
                originalByteLength: httpTranscriptBodyByteLimit + 1
            }
        )
    ]);
};

const emptyTranscriptViewChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    transcript: TranscriptView
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(isTranscriptView(transcript), true),
        check.equal(isTranscriptView({ entries: [] }), false),
        check.equal(transcript.firstEntry, null),
        check.equal(transcript.lastEntry, null),
        check.equal(transcript.nthEntry(0), null),
        check.equal(transcript.nthEntry(Number.MAX_SAFE_INTEGER + 1), null)
    ]);
};

const assertTranscriptPrimitives = defineCompositeAssertion({
    name: 'transcript primitives',
    assert(check) {
        const transcript = emptyTranscriptView();
        const recorder = createHttpTranscriptRecorder<null>();
        const captureError = captureErrorHttpTranscript('broken').firstEntry;
        recorder.recordCaptureError('node-http', 'broken', null);
        if (captureError === null) {
            return check.defined(captureError);
        }
        return check.group([
            check.defined(captureError),
            emptyTranscriptViewChecks(check.annotated('empty transcript view'), transcript),
            recordedBodiesChecks(check.annotated('recorded bodies')),
            check.deepEqual(recordedHttpError('broken'), { message: 'broken', name: 'Error' }),
            check.deepEqual(captureError, nonErrorCapture),
            check.deepEqual(recorder.transcript.entries, [
                [ 'capture-error', { message: 'broken', source: 'node-http' } ]
            ])
        ]);
    }
});

export const testNode = suite('Transcript store', [
    test('HTTP transcript primitives expose immutable safe values', async function (scope) {
        await runWithTranscriptScope(null, async function assertLifetimePrimitives() {
            scope.assert(assertTranscriptPrimitives);
        });

        return scope.assert.collect();
    }),
    test('transcript stores isolate entries by active scope', async function (scope) {
        await runWithTranscriptScope(null, async function assertScopeRestoration() {
            const scopedTranscriptStoreFirstScope = {};
            const scopedTranscriptStoreEmptyScope = {};
            const scopedTranscriptStoreStore = createTranscriptStore<readonly ['state', number]>();

            scopedTranscriptStoreStore.recordInScope(scopedTranscriptStoreFirstScope, 'state', 1);
            scopedTranscriptStoreStore.recordInScope(null, 'state', 2);
            await runWithTranscriptScope(scopedTranscriptStoreFirstScope, async function assertFirstScope() {
                scope.assert.deepEqual(scopedTranscriptStoreStore.view.entries, [ [ 'state', 1 ] ]);
            });
            await runWithTranscriptScope(scopedTranscriptStoreEmptyScope, async function assertEmptyScope() {
                scope.assert.deepEqual(scopedTranscriptStoreStore.view.entries, []);
                await runWithTranscriptScope(null, async function assertLifetimeEvidence() {
                    scope.assert.deepEqual(scopedTranscriptStoreStore.view.entries, [ [ 'state', 1 ], [ 'state', 2 ] ]);
                });
                scope.assert.deepEqual(scopedTranscriptStoreStore.view.entries, []);
            });
            scope.assert.deepEqual(scopedTranscriptStoreStore.view.entries, [ [ 'state', 1 ], [ 'state', 2 ] ]);
        });

        return scope.assert.collect();
    })
]);
