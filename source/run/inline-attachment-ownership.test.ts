import { AsyncResource } from 'node:async_hooks';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type ParameterizedTestScope, table, suite, test, type TestScope } from '@overkill-dev/test';
import { captureRejectedError } from '../test-support/captured-error.ts';

import {
    createFailureArtifactStream,
    closeAttemptFailureStreams,
    type FailureArtifactStream
} from '../attachments/failure-artifact-stream.ts';

import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import {
    inlineAttachmentFixture,
    type AttachmentFixture,
    attachmentWork as work
} from '../test-support/attachment-fixture.ts';
import { attachmentsForProducer, preparedResourceAttachments } from '../attachments/attachment-context.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';

const metadata = { mediaType: 'application/json', name: 'evidence' };

export const testNode = suite('inline attachment ownership', [
    test(
        'prepared evidence cannot borrow an active attempt when its own attempt is unknown',
        async function (scope: TestScope) {
            const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            await runWithAttachmentExecution(execution, async function ownedRun() {
                await execution.runAttempt(work, { index: 0 }, async function selectedAttempt() {
                    const attachments = preparedResourceAttachments(
                        'service',
                        { kind: 'attempt', work, attempt: { index: 99 } },
                        'instrumented',
                        'attachment'
                    );
                    scope.require.defined(attachments);
                    const error = await captureRejectedError(async function rejectUnknownAttempt() {
                        await attachments.json(metadata, { ready: true });
                    });
                    scope.assert.equal(error.message, 'Failure artifact escaped its test attempt.');
                });
            });
            const errors = await execution.finish();
            scope.assert(
                defineCompositeAssertion({
                    name: 'prepared evidence cannot borrow an active attempt when its own attempt is unknown',
                    assert(check) {
                        return check.group([
                            check.equal(errors.length, 1),
                            check.equal(errors[0]?.subtype, 'attribution-drift'),
                            check.deepEqual(store.artifacts(), [])
                        ]);
                    }
                })
            );

            return scope.assert.collect();
        }
    ),
    test(
        'simultaneous runs keep service streams with identical work identities separate',
        async function (scope) {
            const [ left, right ] = [
                inlineAttachmentFixture(defaultAttachmentLimits, [ work ]),
                inlineAttachmentFixture(defaultAttachmentLimits, [ work ])
            ];
            const rightStarted = Promise.withResolvers<undefined>();
            const leftFinished = Promise.withResolvers<undefined>();
            async function finishRight(stream: FailureArtifactStream): Promise<void> {
                rightStarted.resolve(undefined);
                await leftFinished.promise;
                stream.write(' end');
                await stream.close();
            }
            async function finishLeft(): Promise<void> {
                await rightStarted.promise;
                await closeAttemptFailureStreams(work, { index: 0 });
                leftFinished.resolve(undefined);
            }
            async function capturedAttempt(fixture: AttachmentFixture, side: 'left' | 'right'): Promise<void> {
                await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
                    await fixture.execution.runAttempt(work, { index: 0 }, async function sharedWorkIdentity() {
                        const stream = createFailureArtifactStream(
                            { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                            'boundary-captured',
                            'stdout',
                            'text/plain'
                        );
                        if (stream === null) {
                            throw new Error('Expected managed service capture.');
                        }
                        stream.write(side);
                        await (side === 'right' ? finishRight(stream) : finishLeft());
                    });
                });
            }
            await Promise.all([ capturedAttempt(left, 'left'), capturedAttempt(right, 'right') ]);
            scope.assert.partialDeepEqual<unknown, unknown>(right.store.artifacts()[0], {
                payload: { content: { kind: 'text', text: 'right end' } }
            });

            return scope.assert.collect();
        }
    ),
    test('late service output preserves its expired attempt attribution', async function (scope) {
        const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        const captured = Promise.withResolvers<FailureArtifactStream>();
        await runWithAttachmentExecution(execution, async function captureFirstAttempt() {
            await execution.runAttempt(work, { index: 0 }, async function serviceOutput() {
                const stream = createFailureArtifactStream(
                    { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                    'boundary-captured',
                    'stdout',
                    'text/plain'
                );
                if (stream === null) {
                    throw new Error('Expected managed service capture.');
                }
                stream.write('first attempt');
                await stream.close();
                captured.resolve(stream);
            });
        });
        const stream = await captured.promise;
        stream.write('late output');
        const errors = await execution.finish();
        scope.assert(
            defineCompositeAssertion({
                name: 'late service output preserves its expired attempt attribution',
                assert(check) {
                    return check.group([
                        check.equal(errors[0]?.subtype, 'attribution-drift'),
                        check.equal(store.artifacts().length, 1)
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test('captured resource attachment APIs reject writes after the integration run ends', async function (scope) {
        const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        const attachments = execution.context.forProducer({ kind: 'resource', name: 'service' });
        await attachments.json(metadata, { ready: true });
        await execution.finish();
        const error = await captureRejectedError(async function rejectLateRunAttachment() {
            await attachments.json(metadata, { late: true });
        });
        scope.assert.equal(error.message, 'Attachment escaped its integration run.');
        scope.assert(
            defineCompositeAssertion({
                name: 'captured resource attachment APIs reject writes after the integration run ends',
                assert(check) {
                    return check.group([
                        check.equal(store.artifacts().length, 1),
                        check.equal(execution.takeErrors({ kind: 'run' })[0]?.subtype, 'attribution-drift')
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    table({
        title: 'rejects malformed UTF-8 byte without exceeding the text limit',
        cases: [ 255, 195 ],
        caseTitle: String,
        async test(scope: ParameterizedTestScope<number>) {
            const byte = scope.parameters;
            const { execution, store } = inlineAttachmentFixture({ ...defaultAttachmentLimits, maxInlineBytes: 2 }, [
                work
            ]);
            await execution.runAttempt(work, { index: 0 }, async function retainValidPrefix() {
                const rejectedTextBytesWriter = await execution.context.forProducer({ kind: 'case' }).open({
                    kind: 'text',
                    name: 'log',
                    mediaType: 'text/plain'
                });
                await rejectedTextBytesWriter.write('a');
                const error = await captureRejectedError(async function rejectMalformedText() {
                    await rejectedTextBytesWriter.write(Uint8Array.of(byte));
                    await rejectedTextBytesWriter.close();
                });
                scope.assert.equal(error.name, 'AttachmentOperationError');
            });
            scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1);
            const rejectedTextBytesContent = store.artifacts()[0]?.payload.content;
            scope.require.defined(rejectedTextBytesContent);
            scope.assert.deepEqual(rejectedTextBytesContent, {
                kind: 'text',
                text: 'a',
                byteLength: 1,
                completion: { kind: 'incomplete', reason: 'write-error' }
            });

            return scope.assert.collect();
        }
    }),
    test('expired attempts fail without attributing evidence to another attempt', async function (scope) {
        const { execution, store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        const deferred = Promise.withResolvers<() => Promise<unknown>>();
        await runWithAttachmentExecution(execution, async function scheduleLateAttachment() {
            await execution.runAttempt(work, { index: 0 }, async function firstAttempt() {
                const attachments = attachmentsForProducer({ kind: 'case' });
                deferred.resolve(AsyncResource.bind(async function emitExpiredAttachment() {
                    return await attachments.json(metadata, { late: true });
                }));
            });
        });
        const expired = await deferred.promise;
        const expiredAttachmentError = await captureRejectedError(expired);
        scope.assert.equal(expiredAttachmentError.message, 'Attachment escaped its test attempt.');
        const errors = execution.takeErrors({ kind: 'run' });
        scope.assert(
            defineCompositeAssertion({
                name: 'expired attempts fail without attributing evidence to another attempt',
                assert(check) {
                    return check.group([
                        check.equal(errors[0]?.subtype, 'attribution-drift'),
                        check.equal(errors[0]?.attributedToWork, null),
                        check.equal(store.artifacts().length, 0)
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test('attachment budgets span every attempt in a retry chain', async function (scope) {
        const limits = { ...defaultAttachmentLimits, maxScopeBytes: 3, maxScopeAttachments: 2 };
        const { execution, store } = inlineAttachmentFixture(limits, [ work ]);
        await runWithAttachmentExecution(execution, async function writeAcrossRetryChain() {
            for (const index of [ 0, 1 ]) {
                await execution.runAttempt(work, { index }, async function writeAttempt() {
                    const writer = await attachmentsForProducer({ kind: 'case' }).open({
                        kind: 'text',
                        mediaType: 'text/plain',
                        name: 'log'
                    });
                    await writer.write('ab');
                    await writer.close();
                });
            }
            const retryLimitError = await captureRejectedError(async function exceedRetryCount() {
                    await execution.runAttempt(work, { index: 2 }, async function thirdAttempt() {
                        await attachmentsForProducer({ kind: 'case' }).json(metadata, {});
                    });
                });
            scope.assert.equal(
                retryLimitError.message,
                'Attachment count limit exceeded.'
            );
        });
        const retained = store.artifacts().map(function retainedText(artifact) {
            return artifact.payload.content.kind === 'text' ? artifact.payload.content.text : null;
        });
        scope.assert(
            defineCompositeAssertion({
                name: 'attachment budgets span every attempt in a retry chain',
                assert(check) {
                    return check.group([
                        check.deepEqual(retained, [ 'ab', 'a' ]),
                        check.equal(
                            execution
                                .takeErrors({ attempt: { index: 2 }, kind: 'case', work })
                                .length,
                            1
                        )
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test('oversized JSON is omitted and caught validation errors still fail the attempt', async function (scope) {
        const { execution, store } = inlineAttachmentFixture({ ...defaultAttachmentLimits, maxInlineBytes: 5 }, [
            work
        ]);
        await runWithAttachmentExecution(execution, async function rejectInvalidAndOmitLargeJson() {
            await execution.runAttempt(work, { index: 0 }, async function captureJson() {
                const attachments = attachmentsForProducer({ kind: 'case' });
                const omitted = await attachments.json(metadata, { large: 'evidence' });
                scope.assert.deepEqual(omitted.payload.content, { kind: 'omitted', limit: 5, reason: 'byte-limit' });
                const invalidJsonError = await captureRejectedError(async function invalidJson() {
                        await attachments.json(metadata, Number.NaN);
                    });
                scope.assert.equal(
                    invalidJsonError.name,
                    'AttachmentOperationError'
                );
            });
        });
        scope.assert(
            defineCompositeAssertion({
                name: 'oversized JSON is omitted and caught validation errors still fail the attempt',
                assert(check) {
                    return check.group([
                        check.equal(store.artifacts().length, 1),
                        check.equal(execution.takeErrors({ attempt: { index: 0 }, kind: 'case', work }).length, 1)
                    ]);
                }
            })
        );

        return scope.assert.collect();
    })
]);
