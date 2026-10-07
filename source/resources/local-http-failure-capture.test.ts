import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { runWithResourceFailureContext } from '../attachments/resource-failure-context.ts';
import { createHttpTranscriptRecorder, type HttpInteraction } from '../transcript/http-transcript.ts';
import { observeHttpFailureArtifacts } from './local-http-failure-capture.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const context = { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } } as const;
function invalidInteraction(): HttpInteraction<null> {
    return {
        context: null,
        sequence: 0,
        outcome: { kind: 'incomplete', reason: 'resource-disposed' },
        request: {
            body: { kind: 'absent' },
            headers: [],
            method: 'GET',
            get url(): string {
                throw new Error('URL unavailable');
            }
        }
    };
}
async function assertSerializationFailure(scope: TestScope): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(work, { index: 0 }, async function failingTranscript() {
            await runWithResourceFailureContext(context, async function captureHttp() {
                const recorder = createHttpTranscriptRecorder<null>();
                const capture = observeHttpFailureArtifacts('service', recorder.transcript);
                scope.require.defined(capture);
                recorder.record(invalidInteraction(), null);
                await scope.assert.rejects(capture.close, { message: 'HTTP transcript capture failed.' });
                recorder.recordCaptureError('custom', 'after disposal', null);
            });
        });
    });
    scope.assert.deepEqual(fixture.store.artifacts(), []);
}
async function assertCaptureErrors(scope: TestScope): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(work, { index: 0 }, async function captureTranscript() {
            await runWithResourceFailureContext(context, async function captureHttp() {
                const recorder = createHttpTranscriptRecorder<null>();
                const capture = observeHttpFailureArtifacts('service', recorder.transcript);
                scope.require.defined(capture);
                recorder.recordCaptureError('custom', 'first', null);
                recorder.recordCaptureError('custom', 'second', null);
                await capture.close();
            });
        });
    });
    const artifact = fixture.store.artifacts()[0];
    scope.require.defined(artifact);
    if (artifact.payload.content.kind !== 'text') {
        throw new Error('Expected HTTP transcript text.');
    }
    scope.assert.equal(
        artifact.payload.content.text,
        '["capture-error",{"message":"first","source":"custom"}]\n["capture-error",{"message":"second","source":"custom"}]\n'
    );
}
async function assertUnknownTranscriptScope(scope: TestScope): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    const lifetime = {
        name: 'service',
        condition: { kind: 'resource', resource: 'service', boundary: 'shared' }
    } as const;
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(work, { index: 0 }, async function activeAttempt() {
            await runWithResourceFailureContext(lifetime, async function captureUncorrelatedHttp() {
                const recorder = createHttpTranscriptRecorder<null>();
                const capture = observeHttpFailureArtifacts('service', recorder.transcript);
                scope.require.defined(capture);
                recorder.recordCaptureError('custom', 'manual scope', { manual: true });
                await capture.close();
            });
        });
    });
    scope.assert.equal(fixture.store.artifacts().length, 1);
    scope.assert.equal(fixture.store.artifacts()[0]?.id.scope.kind, 'run');
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/resources/local-http-failure-capture.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'unknown transcript scopes retain shared resource attribution despite an active case',
            async body(scope: TestScope) {
                await assertUnknownTranscriptScope(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'HTTP serialization errors surface when capture closes and stop observation',
            async body(scope: TestScope) {
                await assertSerializationFailure(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'HTTP capture diagnostics append to the same bounded stream',
            async body(scope: TestScope) {
                await assertCaptureErrors(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'unmanaged transcript observation records no failure artifacts',
            async body(scope: TestScope) {
                const recorder = createHttpTranscriptRecorder<null>();
                await runWithResourceFailureContext(context, async function unmanagedCapture() {
                    const capture = observeHttpFailureArtifacts('service', recorder.transcript);
                    scope.require.defined(capture);
                    recorder.recordCaptureError('custom', 'outside runner', null);
                    await capture.close();
                });
                scope.assert.equal(recorder.transcript.entryCount, 1);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
