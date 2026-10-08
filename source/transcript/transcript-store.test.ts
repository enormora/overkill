import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
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
import {
    createTranscriptStore,
    isTranscriptView,
    runWithTranscriptScope
} from './transcript-store.ts';

const textEncoder = new TextEncoder();
const nonErrorCapture: TranscriptCaptureErrorEntry = [
    'capture-error',
    { message: 'broken', source: 'custom' }
];

function assertRecordedBodies(scope: TestScope): void {
    scope.assert.deepEqual(recordedHttpBody(null), { kind: 'absent' });
    scope.assert.deepEqual(recordedHttpBody(new Uint8Array()), { kind: 'absent' });
    scope.assert.deepEqual(recordedHttpBody(textEncoder.encode('body')), {
        bytes: textEncoder.encode('body'),
        kind: 'complete'
    });
    scope.assert.deepEqual(
        recordedHttpBody(new Uint8Array(httpTranscriptBodyByteLimit + 1)),
        {
            bytes: new Uint8Array(httpTranscriptBodyByteLimit),
            kind: 'truncated',
            originalByteLength: httpTranscriptBodyByteLimit + 1
        }
    );
}

function assertEmptyTranscriptView(
    scope: TestScope,
    transcript: TranscriptView
): void {
    scope.assert.equal(isTranscriptView(transcript), true);
    scope.assert.equal(isTranscriptView({ entries: [] }), false);
    scope.assert.equal(transcript.firstEntry, null);
    scope.assert.equal(transcript.lastEntry, null);
    scope.assert.equal(transcript.nthEntry(0), null);
    scope.assert.equal(transcript.nthEntry(Number.MAX_SAFE_INTEGER + 1), null);
}

function assertTranscriptPrimitives(scope: TestScope): void {
    const transcript = emptyTranscriptView();
    const recorder = createHttpTranscriptRecorder<null>();
    const captureError = captureErrorHttpTranscript('broken').firstEntry;

    recorder.recordCaptureError('node-http', 'broken', null);
    scope.require.defined(captureError);

    assertEmptyTranscriptView(scope, transcript);
    assertRecordedBodies(scope);
    scope.assert.deepEqual(recordedHttpError('broken'), { message: 'broken', name: 'Error' });
    scope.assert.deepEqual(captureError, nonErrorCapture);
    scope.assert.deepEqual(recorder.transcript.entries, [
        [ 'capture-error', { message: 'broken', source: 'node-http' } ]
    ]);
}

async function assertScopedTranscriptStore(scope: TestScope): Promise<void> {
    const firstScope = {};
    const emptyScope = {};
    const store = createTranscriptStore<readonly ['state', number]>();

    store.recordInScope(firstScope, 'state', 1);
    store.recordInScope(null, 'state', 2);
    await runWithTranscriptScope(firstScope, async function assertFirstScope() {
        scope.assert.deepEqual(store.view.entries, [ [ 'state', 1 ] ]);
    });
    await runWithTranscriptScope(emptyScope, async function assertEmptyScope() {
        scope.assert.deepEqual(store.view.entries, []);
        await runWithTranscriptScope(null, async function assertLifetimeEvidence() {
            scope.assert.deepEqual(store.view.entries, [ [ 'state', 1 ], [ 'state', 2 ] ]);
        });
        scope.assert.deepEqual(store.view.entries, []);
    });
    scope.assert.deepEqual(store.view.entries, [ [ 'state', 1 ], [ 'state', 2 ] ]);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/transcript/transcript-store.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'HTTP transcript primitives expose immutable safe values',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertTranscriptPrimitives(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'transcript stores isolate entries by active scope',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertScopedTranscriptStore(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
