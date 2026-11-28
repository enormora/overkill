import { writeFile, readFile } from 'node:fs/promises';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';
import type { AttachmentResponse } from '../../../run/attachment-protocol.ts';

import {
    defaultAttachmentLimits,
    type RuntimeAttachmentArtifact,
    type AttachmentWriter,
    type RuntimeAttachments
} from '../../../engine/runtime-attachment.ts';
import {
    attachmentFixture,
    attachmentWork as work,
    type AttachmentFixture
} from '../../../test-support/attachment-fixture.ts';
import { captureRejectedError } from '../../../test-support/captured-error.ts';
import { snapshotJson } from '../../../attachments/json-snapshot.ts';
import { createAttachmentExecution, type AttachmentExecution } from '../../../run/attachment-execution.ts';
import { createAttachmentStream } from '../../../run/attachment-writer.ts';

const metadata = { name: 'evidence', mediaType: 'application/octet-stream' };

const assertBinaryContent = defineCompositeAssertion({
    name: 'binary content',
    assert(check, artifact: RuntimeAttachmentArtifact) {
        if (artifact.payload.content.kind !== 'file') {
            throw new Error('Expected a retained file.');
        }
        return check.group([
            check.equal(artifact.payload.content.byteLength, 1),
            check.deepEqual(artifact.payload.content.completion, { kind: 'complete' })
        ]);
    }
});

const assertFailedWriter = defineCompositeAssertion({
    name: 'failed writer',
    async assert(check, attachments: RuntimeAttachments) {
        const writer = await attachments.open({ ...metadata, kind: 'binary' });
        const first = await captureRejectedError(async function () {
            await writer.write(Uint8Array.of(1, 2, 3, 4));
        });
        const later = await captureRejectedError(async function () {
            await writer.write(Uint8Array.of(5));
        });
        const closing = await captureRejectedError(writer.close);
        return check.group([
            check.equal(first?.message, 'Binary attachment byte limit exceeded.'),
            check.equal(later?.message, 'Binary attachment byte limit exceeded.'),
            check.equal(closing?.message, 'Binary attachment byte limit exceeded.')
        ]);
    }
});

function rejectCaptureTransport(cause: unknown): never {
    throw cause;
}

type RejectedAttachmentWriteEvidence = {
    readonly omitted: AttachmentResponse;
    readonly store: AttachmentFixture['store'];
};

const rejectedAttachmentWrite = defineCompositeAssertion({
    name: 'rejected attachment write',
    async assert(
        check,
        { omitted, store }: RejectedAttachmentWriteEvidence
    ) {
        return check.group([
            check.deepEqual(omitted, {
                kind: 'error',
                message: 'Attachment writer is closed.',
                reason: 'operation-error'
            }),
            check.deepEqual(await store.finish(null), []),
            check.equal(store.artifacts()[0]?.payload.content.kind, 'file')
        ]);
    }
});

const pendingWriteFailure = defineCompositeAssertion({
    name: 'write and close retain the pending transport failure',
    async assert(
        check,
        writer: AttachmentWriter<Uint8Array | string>,
        pending: ReturnType<typeof Promise.withResolvers<undefined>>
    ) {
        const writing = writer.write('log');
        const rejectedWrite = captureRejectedError(async function () {
            await writing;
        });
        const closing = writer.close();
        const rejectedClose = captureRejectedError(async function () {
            await closing;
        });
        pending.reject(new Error('transport write failed'));
        const [ writeError, closeError ] = await Promise.all([ rejectedWrite, rejectedClose ]);
        return check.group([
            check.equal(writeError?.message, 'transport write failed'),
            check.equal(closeError?.message, 'transport write failed')
        ]);
    }
});
const overlappingWrite = defineCompositeAssertion({
    name: 'rejects overlapping writes while close waits for completion',
    async assert(
        check,
        writer: AttachmentWriter<Uint8Array | string>,
        pending: PromiseWithResolvers<undefined>
    ) {
        const writing = writer.write('one');
        const rejected = await captureRejectedError(async function () {
            await writer.write('two');
        });
        const closing = writer.close();
        pending.resolve(undefined);
        const [ , artifact ] = await Promise.all([ writing, closing ]);
        return check.group([
            check.equal(rejected?.message, 'Attachment writes require an open writer and an awaited previous write.'),
            check.deepEqual(artifact.payload.content, {
                kind: 'text',
                text: 'one',
                byteLength: 3,
                completion: { kind: 'complete' }
            })
        ]);
    }
});
const attachmentCompletionErrors = defineCompositeAssertion({
    name: 'retains every rejected attachment operation',
    async assert(check, execution: AttachmentExecution, expected: number) {
        const errors = await execution.finish();
        return check.equal(errors.length, expected);
    }
});
export const testNode = suite('Runtime attachment validation', [
    test('foreign transport rejections preserve incomplete capture metadata', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const opened = await store.exchange('test', {
            kind: 'open',
            branch: null,
            contentKind: 'text',
            metadata,
            owner: { kind: 'run' },
            producer: { kind: 'case' }
        });
        if (opened.kind !== 'opened') {
            throw new Error('Expected text writer.');
        }
        const writer = createAttachmentStream(
            {
                owner: { kind: 'run' },
                fail(message) {
                    return new Error(message);
                },
                verify() {
                    return undefined;
                },
                release() {
                    return undefined;
                },
                async send(operation) {
                    if (operation.kind === 'write') {
                        return rejectCaptureTransport(null);
                    }
                    return await store.exchange('test', operation);
                }
            },
            opened.writer,
            'text'
        );
        await scope.assert.rejects(async function foreignWrite() {
            await writer.write('prefix');
        }, { message: 'Attachment write failed.' });
        await scope.assert.rejects(async function failedClose() {
            await writer.close();
        }, { message: 'Attachment write failed.' });
        scope.assert.partialDeepEqual<unknown, unknown>(store.artifacts()[0], {
            payload: {
                content: {
                    kind: 'text',
                    text: '',
                    completion: { kind: 'incomplete', reason: 'write-error' }
                }
            }
        });

        return scope.assert.collect();
    }),
    test('failed binary writers refuse further operations and do not add unclosed errors', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, { ...defaultAttachmentLimits, maxArtifactBytes: 1 });
        const opened = await store.exchange('test', {
            kind: 'open',
            branch: null,
            contentKind: 'binary',
            metadata,
            owner: { kind: 'case', work, attempt: { index: 0 } },
            producer: { kind: 'case' }
        });
        if (opened.kind !== 'opened') {
            throw new Error('Expected binary writer.');
        }
        const failed = await store.exchange('test', {
            kind: 'write',
            writer: opened.writer,
            data: Buffer.from([ 1, 2 ]).toString('base64')
        });
        scope.assert.deepEqual(failed, {
            kind: 'error',
            message: 'Binary attachment byte limit exceeded.',
            reason: 'byte-limit'
        });
        const omitted = await store.exchange('test', { kind: 'omit', writer: opened.writer });
        await scope.assert(rejectedAttachmentWrite, { omitted, store });

        return scope.assert.collect();
    }),
    test('resource consumers cannot substitute another runtime variant of a selected case', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const foreign = { ...work, runtimes: [ { name: 'outside', dimensions: {}, scenarios: {}, variantId: null } ] };
        const response = await store.exchange('test', { kind: 'resource-consumer', boundary: 'owner', work: foreign });
        scope.assert(
            defineCompositeAssertion({
                name: 'resource consumers cannot substitute another runtime variant of a selected case',
                assert(check) {
                    return check.group([
                        check.deepEqual(response, {
                            kind: 'error',
                            message: 'Resource consumer is outside selected work.',
                            reason: 'operation-error'
                        }),
                        check.deepEqual(store.selectedArtifacts(), [])
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test(
        'a pending write failure keeps the artifact incomplete when close races it',
        async function (scope) {
            const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
            const pending = Promise.withResolvers<undefined>();
            const execution = createAttachmentExecution(async function failPendingTransport(operation) {
                if (operation.kind === 'write') {
                    await pending.promise;
                }
                return store.exchange('pending', operation);
            }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
            const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });

            await scope.assert(pendingWriteFailure, writer, pending);

            const content = store.artifacts()[0]?.payload.content;
            scope.assert.deepEqual<unknown, unknown>(content, {
                kind: 'text',
                text: '',
                byteLength: 0,
                completion: { kind: 'incomplete', reason: 'write-error' }
            });

            return scope.assert.collect();
        }
    ),
    test('close waits for the pending write and overlapping writes are rejected', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const pending = Promise.withResolvers<undefined>();
        const execution = createAttachmentExecution(async function waitForWrite(operation) {
            if (operation.kind === 'write') {
                await pending.promise;
            }
            return store.exchange('pending', operation);
        }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
        const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });
        await scope.assert(overlappingWrite, writer, pending);

        return scope.assert.collect();
    }),
    test('binary writers reject strings and writes after close', async function (scope) {
        const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'binary' });
        const invalidType = await captureRejectedError(async function rejectTextOnBinary() {
            await Reflect.apply(writer.write, undefined, [ 'text' ]);
        });
        await writer.write(Uint8Array.of(1));
        const artifact = await writer.close();
        const closed = await captureRejectedError(async function rejectClosedWriter() {
            await writer.write(Uint8Array.of(2));
        });
        scope.assert.deepEqual({
            invalidType: invalidType?.message,
            closed: closed?.message,
            artifacts: store.artifacts().length
        }, {
            invalidType: 'Binary attachment writers require bytes.',
            closed: 'Attachment writes require an open writer and an awaited previous write.',
            artifacts: 1
        });
        scope.assert(assertBinaryContent, artifact);
        await scope.assert(attachmentCompletionErrors, execution, 2);

        return scope.assert.collect();
    }),
    suite('file capture copies evidence and preserves overflow failures', [
        test('independent copy', async function (scope) {
            const { execution, directory } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
            const source = `${directory}/source.bin`;
            await writeFile(source, Uint8Array.of(1, 2));
            const attachments = execution.context.forProducer({ kind: 'resource', name: 'browser' });
            const copied = await attachments.file(metadata, source);
            await writeFile(source, Uint8Array.of(4, 5, 6, 7));
            if (copied.payload.content.kind !== 'file') {
                throw new Error('Expected a retained file.');
            }
            scope.assert.deepEqual(Array.from(await readFile(copied.payload.content.path)), [ 1, 2 ]);

            return scope.assert.collect();
        }),
        test('file overflow', async function (scope) {
            const { execution, directory, store } = await attachmentFixture(scope.cleanup, {
                ...defaultAttachmentLimits,
                maxArtifactBytes: 3
            });
            const source = `${directory}/source.bin`;
            await writeFile(source, Uint8Array.of(4, 5, 6, 7));
            const attachments = execution.context.forProducer({ kind: 'resource', name: 'browser' });
            const overflow = await captureRejectedError(async function rejectOversizedFile() {
                await attachments.file(metadata, source);
            });
            await scope.assert(assertFailedWriter, attachments);
            const errors = await execution.finish();
            scope.assert.deepEqual({
                overflow: overflow?.message,
                artifacts: store.artifacts().length,
                errors: errors.length
            }, {
                overflow: 'Binary attachment byte limit exceeded.',
                artifacts: 2,
                errors: 2
            });

            return scope.assert.collect();
        })
    ]),
    test('JSON descriptors and depth preserve representable values', function (scope) {
        const accessor = Object.defineProperty({}, 'value', {
            enumerable: true,
            get() {
                throw new Error('invoked');
            }
        });
        for (const value of [ accessor, { [Symbol('key')]: true } ]) {
            scope.assert.throws(function rejectInvalidJson() {
                snapshotJson(value, 1024);
            }, { name: 'TypeError' });
        }
        const shared = { ready: true };
        const value = { first: shared, second: shared };
        Object.setPrototypeOf(value, null);
        Object.defineProperty(value, 'ignored', { value: undefined });
        scope.assert.equal(
            snapshotJson(value, 1024)?.encoded,
            '{"first":{"ready":true},"second":{"ready":true}}'
        );
        scope.assert.throws(function rejectDeepJson() {
            snapshotJson(
                Array.from({ length: 66 }).reduce<unknown>(function (child) {
                    return [ child ];
                }, null),
                1024
            );
        }, { message: 'Attachments require finite, acyclic JSON values with depth at most 64.' });

        return scope.assert.collect();
    }),
    test('invalid metadata and JSON failures remain bounded per attempt', async function (scope) {
        const { execution } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        await execution.runAttempt(work, { index: 0 }, async function rejectInvalidMetadata() {
            const attachments = execution.context.forProducer({ kind: 'case' });
            for (const name of [ '', 'x'.repeat(257), '\u{7F}', '\n' ]) {
                const failure = await captureRejectedError(async function invalidMetadata() {
                    await attachments.open({ name, mediaType: 'text/plain', kind: 'text' });
                });
                scope.assert.equal(failure?.name, 'AttachmentOperationError');
            }
            for (let index = 0; index < 101; index += 1) {
                const failure = await captureRejectedError(async function invalidJson() {
                    await attachments.json(metadata, undefined);
                });
                scope.assert.equal(failure?.name, 'AttachmentOperationError');
            }
        });
        scope.assert(
            defineCompositeAssertion({
                name: 'invalid metadata and JSON failures remain bounded per attempt',
                assert(check) {
                    return check.group([
                        check.equal(
                            execution
                                .takeErrors({ kind: 'case', work, attempt: { index: 0 } })
                                .length,
                            100
                        ),
                        check.deepEqual(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }), [])
                    ]);
                }
            })
        );

        return scope.assert.collect();
    })
]);
