import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

import { captureRejectedError } from '../test-support/captured-error.ts';
import { inlineAttachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { createAttachmentExecution } from '../run/attachment-execution.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import {
    createFailureArtifactStream,
    closeAttemptFailureStreams,
    type FailureArtifactStream
} from './failure-artifact-stream.ts';

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
const assertCaptureFailure = defineCompositeAssertion({
    name: 'capture transport failure',
    async assert(check, cause: unknown, operation: 'close' | 'prepare' | 'write', closeOnOwner: boolean) {
        const fixture = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        const execution = createAttachmentExecution(async function failingTransport(request) {
            if (request.kind === operation) {
                throw cause;
            }
            return await fixture.store.exchange('test', request);
        }, defaultAttachmentLimits);
        const failure = await runWithAttachmentExecution(execution, async function () {
            return await execution.runAttempt(work, { index: 0 }, async function () {
                const stream = attemptStream();
                stream.write('received');
                const error = await captureRejectedError(async function () {
                    if (closeOnOwner) {
                        await closeAttemptFailureStreams(work, { index: 0 });
                    } else {
                        await stream.close();
                    }
                });
                await stream.close();
                return error;
            });
        });
        return check.group([
            check.equal(failure.message, captureFailureMessage(cause, closeOnOwner)),
            check.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1)
        ]);
    }
});

export const testNode = suite('Failure artifact stream', [
    test(
        'late output reports a closed writer failure while preserving captured evidence',
        async function (scope: TestScope) {
            const fixture = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
                await fixture.execution.runAttempt(work, { index: 0 }, async function closedCapture() {
                    const stream = attemptStream();
                    stream.write('received');
                    await stream.close();
                    stream.write('late');
                    await closeAttemptFailureStreams(work, { index: 0 });
                });
            });
            const errors = fixture.execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } });
            scope.assert.equal(errors.length, 1);
            scope.assert.equal(
                errors[0]?.message,
                'Attachment writes require an open writer and an awaited previous write.'
            );
            const artifact = fixture.store.artifacts()[0];
            scope.require.defined(artifact);
            scope.assert.partialDeepEqual(artifact.payload.content, {
                kind: 'text',
                text: 'received',
                completion: { kind: 'complete' }
            });

            return scope.assert.collect();
        }
    ),
    test('attempt cleanup reports failed stream drains as an aggregate error', async function (scope) {
        await scope.assert(assertCaptureFailure, new Error('disconnected'), 'prepare', true);
        return scope.assert.collect();
    }),
    test('unmanaged captures remain unavailable without opening streams', async function (scope) {
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
    }),
    test(
        'capture limits preserve complete UTF-8 characters and discard subsequent output',
        async function (scope: TestScope) {
            const limits = { ...defaultAttachmentLimits, maxInlineBytes: 16 };
            const fixture = inlineAttachmentFixture(limits, [ work ]);
            await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
                await fixture.execution.runAttempt(work, { index: 0 }, async function overflowingOutput() {
                    const stream = attemptStream();
                    stream.write(`${'x'.repeat(limits.maxInlineBytes - 1)}🌍`);
                    stream.write('discarded');
                    await closeAttemptFailureStreams(work, { index: 0 });
                    await stream.close();
                });
            });
            const artifact = fixture.store.artifacts()[0];
            scope.require.defined(artifact);
            scope.assert.partialDeepEqual(artifact.payload.content, {
                kind: 'text',
                text: 'x'.repeat(limits.maxInlineBytes - 1),
                completion: { kind: 'incomplete', reason: 'capture-limit' }
            });
            scope.assert.deepEqual(await fixture.execution.finish(), []);

            return scope.assert.collect();
        }
    ),
    test('closed empty captures report late output once without creating evidence', async function (scope) {
        const fixture = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
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

        return scope.assert.collect();
    }),
    table({
        title: 'preserves capture errors after transport failures',
        cases: ([ 'prepare', 'write', 'close' ] as const).flatMap(function failedOperation(operation) {
            return [ new Error('disconnected'), null ].map(function failedCause(cause) {
                return { operation, cause };
            });
        }),
        caseTitle({ operation, cause }) {
            return [ operation, String(cause) ].map(String).join(', ');
        },
        async test(scope) {
            const { operation, cause } = scope.parameters;

            await scope.assert(assertCaptureFailure, cause, operation, false);
            return scope.assert.collect();
        }
    })
]);
