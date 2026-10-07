import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { createAttachmentExecution } from '../run/attachment-execution.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import {
    createFailureArtifactStream,
    closeAttemptFailureStreams,
    type FailureArtifactStream
} from './failure-artifact-stream.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function attemptStream(): FailureArtifactStream {
    const stream = createFailureArtifactStream(
        { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
        'boundary-captured',
        'stdout',
        'text/plain'
    );
    if (stream === null) {
        throw new Error('Expected managed stream.');
    }
    return stream;
}
function captureFailureMessage(cause: unknown, closeOnOwner: boolean): string {
    if (closeOnOwner) {
        return 'Failure artifact streams could not finish.';
    }
    return cause instanceof Error ? cause.message : 'Attachment transport failed.';
}
async function assertCaptureFailure(
    scope: TestScope,
    cause: unknown,
    operation: 'close' | 'prepare' | 'write',
    closeOnOwner: boolean
): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    const execution = createAttachmentExecution(async function failingTransport(request) {
        if (request.kind === operation) {
            throw cause;
        }
        return await fixture.store.exchange('test', request);
    }, defaultAttachmentLimits);
    await runWithAttachmentExecution(execution, async function ownedRun() {
        await execution.runAttempt(work, { index: 0 }, async function failingCapture() {
            const stream = attemptStream();
            stream.write('received');
            await scope.assert.rejects(async function finishFailedCapture() {
                if (closeOnOwner) {
                    await closeAttemptFailureStreams(work, { index: 0 });
                } else {
                    await stream.close();
                }
            }, {
                message: captureFailureMessage(cause, closeOnOwner)
            });
            await stream.close();
        });
    });
    scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1);
}
async function assertBoundedUnicode(scope: TestScope): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        await fixture.execution.runAttempt(work, { index: 0 }, async function overflowingOutput() {
            const stream = attemptStream();
            stream.write(`${'x'.repeat(defaultAttachmentLimits.maxInlineBytes - 1)}🌍`);
            stream.write('discarded');
            await closeAttemptFailureStreams(work, { index: 0 });
            await stream.close();
        });
    });
    const artifact = fixture.store.artifacts()[0];
    scope.require.defined(artifact);
    scope.assert.partialDeepEqual(artifact.payload.content, {
        kind: 'text',
        text: 'x'.repeat(defaultAttachmentLimits.maxInlineBytes - 1),
        completion: { kind: 'incomplete', reason: 'capture-limit' }
    });
    scope.assert.deepEqual(await fixture.execution.finish(), []);
}
async function assertLateEmptyCapture(scope: TestScope): Promise<void> {
    const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
    await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        const closedStream = await fixture.execution.runAttempt(work, { index: 0 }, async function emptyCapture() {
            const stream = attemptStream();
            await stream.close();
            return stream;
        });
        closedStream.write('late');
        closedStream.write('later');
        await closeAttemptFailureStreams(work, { index: 0 });
    });
    const errors = await fixture.execution.finish();
    scope.assert.equal(errors.length, 1);
    scope.assert.equal(errors[0]?.subtype, 'attribution-drift');
    scope.assert.deepEqual(fixture.store.artifacts(), []);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/attachments/failure-artifact-stream.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'attempt cleanup reports failed stream drains as an aggregate error',
            async body(scope: TestScope) {
                await assertCaptureFailure(scope, new Error('disconnected'), 'prepare', true);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'unmanaged captures remain unavailable without opening streams',
            async body(scope) {
                scope.assert.equal(
                    createFailureArtifactStream(
                        { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                        'instrumented',
                        'log',
                        'text/plain'
                    ),
                    null
                );
                await closeAttemptFailureStreams(work, { index: 0 });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'capture limits preserve complete UTF-8 characters and discard subsequent output',
            async body(scope) {
                await assertBoundedUnicode(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'closed empty captures report late output once without creating evidence',
            async body(scope) {
                await assertLateEmptyCapture(scope);
                return scope.assert.collect();
            }
        }),
        ...([ 'prepare', 'write', 'close' ] as const).flatMap(function failedOperation(operation) {
            return [ new Error('disconnected'), null ].map(function failedCause(cause) {
                return createTestCase({
                    ...metadata,
                    title: `${operation} failure preserves capture errors: ${String(cause)}`,
                    async body(scope) {
                        await assertCaptureFailure(scope, cause, operation, false);
                        return scope.assert.collect();
                    }
                });
            });
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
