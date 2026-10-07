import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentContext } from '../attachments/attachment-context.ts';
import {
    runWithResourceFailureContext,
    type currentResourceFailureContext,
    createTranscriptAttemptScope,
    transcriptAttempt
} from '../attachments/resource-failure-context.ts';
import {
    type createFailureArtifactStream,
    closeAttemptFailureStreams
} from '../attachments/failure-artifact-stream.ts';
import { createHttpTranscriptRecorder } from '../transcript/http-transcript.ts';
import type { runWithTranscriptScope } from '../transcript/transcript-store.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
type FailureContextCopy = {
    readonly currentResourceFailureContext: typeof currentResourceFailureContext;
    readonly createTranscriptAttemptScope: typeof createTranscriptAttemptScope;
    readonly transcriptAttempt: typeof transcriptAttempt;
};
type StreamCopy = { readonly createFailureArtifactStream: typeof createFailureArtifactStream; };
type TranscriptCopy = { readonly runWithTranscriptScope: typeof runWithTranscriptScope; };
function isFailureContextCopy(value: unknown): value is FailureContextCopy {
    return typeof value === 'object' && value !== null &&
        [ 'currentResourceFailureContext', 'createTranscriptAttemptScope', 'transcriptAttempt' ].every(
            function callable(name) {
                return typeof Reflect.get(value, name) === 'function';
            }
        );
}
function isStreamCopy(value: unknown): value is StreamCopy {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'createFailureArtifactStream') === 'function';
}
function isTranscriptCopy(value: unknown): value is TranscriptCopy {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'runWithTranscriptScope') === 'function';
}
async function copyModule(sourcePath: string): Promise<unknown> {
    const moduleUrl = new URL(`${sourcePath}${path.extname(import.meta.url)}?isolated-copy`, import.meta.url);
    return await import(moduleUrl.href);
}
function assertAttemptScope(scope: TestScope, identity: ReturnType<typeof transcriptAttempt>, index: number): void {
    scope.require.defined(identity);
    scope.assert.deepEqual(identity, { work, attempt: { index } });
}
async function assertSharedFailureContext(scope: TestScope): Promise<void> {
    const copy = await copyModule('../attachments/resource-failure-context');
    if (!isFailureContextCopy(copy)) {
        throw new Error('Expected resource failure context exports.');
    }
    const context = { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } } as const;
    const originalScope = createTranscriptAttemptScope(work, { index: 0 });
    const copiedScope = copy.createTranscriptAttemptScope(work, { index: 1 });
    assertAttemptScope(scope, copy.transcriptAttempt(originalScope), 0);
    assertAttemptScope(scope, transcriptAttempt(copiedScope), 1);
    await runWithResourceFailureContext(context, async function shareContext() {
        scope.assert.equal(copy.currentResourceFailureContext(), context);
    });
    scope.assert.equal(copy.currentResourceFailureContext(), null);
}
async function assertSharedStreamRegistry(scope: TestScope): Promise<void> {
    const copy = await copyModule('../attachments/failure-artifact-stream');
    if (!isStreamCopy(copy)) {
        throw new Error('Expected failure stream exports.');
    }
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentContext(fixture.execution.context, async function shareRun() {
        await fixture.execution.runAttempt(work, { index: 0 }, async function captureCopiedOutput() {
            const stream = copy.createFailureArtifactStream(
                { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                'boundary-captured',
                'stdout',
                'text/plain'
            );
            scope.require.defined(stream);
            stream.write('copied package');
            await closeAttemptFailureStreams(work, { index: 0 });
        });
    });
    const artifact = fixture.store.artifacts()[0];
    scope.require.defined(artifact);
    scope.assert.partialDeepEqual(artifact.payload.content, {
        kind: 'text',
        text: 'copied package',
        completion: { kind: 'complete' }
    });
}
async function assertSharedTranscriptScopes(scope: TestScope): Promise<void> {
    const copy = await copyModule('../transcript/transcript-store');
    if (!isTranscriptCopy(copy)) {
        throw new Error('Expected transcript scope exports.');
    }
    const recorder = createHttpTranscriptRecorder();
    const first = createTranscriptAttemptScope(work, { index: 0 });
    await copy.runWithTranscriptScope(first, async function captureFirstAttempt() {
        scope.assert.equal(recorder.currentScope(), first);
        recorder.recordCaptureError('custom', 'first', recorder.currentScope());
    });
    await copy.runWithTranscriptScope(createTranscriptAttemptScope(work, { index: 1 }), async function separateRetry() {
        scope.assert.equal(recorder.transcript.entryCount, 0);
    });
    scope.assert.equal(recorder.transcript.entryCount, 1);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/run/failure-artifact-sharing.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'copied resource packages share owner context and attempt scope identities',
            async body(scope: TestScope) {
                await assertSharedFailureContext(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'attempt cleanup drains streams created by a copied package',
            async body(scope: TestScope) {
                await assertSharedStreamRegistry(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'copied transcript packages preserve attempt isolation',
            async body(scope: TestScope) {
                await assertSharedTranscriptScopes(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
