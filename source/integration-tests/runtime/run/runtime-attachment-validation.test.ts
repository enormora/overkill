import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { writeFile, readFile } from 'node:fs/promises';
import { suite, test, type TestScope } from '@overkill-dev/test';

import {
    defaultAttachmentLimits,
    type RuntimeAttachmentArtifact,
    type RuntimeAttachments
} from '../../../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentWork as work } from '../../../test-support/attachment-fixture.ts';
import { snapshotJson } from '../../../attachments/json-snapshot.ts';
import { createAttachmentExecution } from '../../../run/attachment-execution.ts';
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
        const first = await check.rejects(async () => {
            await writer.write(Uint8Array.of(1, 2, 3, 4));
        }, { message: 'Binary attachment byte limit exceeded.' });
        const later = await check.rejects(async () => {
            await writer.write(Uint8Array.of(5));
        }, { message: 'Binary attachment byte limit exceeded.' });
        return check.group([
            first,
            later,
            await check.rejects(async () => {
                await writer.close();
            }, { message: 'Binary attachment byte limit exceeded.' })
        ]);
    }
});

function rejectCaptureTransport(cause: unknown): never {
    throw cause;
}

export const testNode = suite('Runtime attachment validation', [
    test('foreign transport rejections preserve incomplete capture metadata', async (scope: TestScope) => {
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
        const artifact = store.artifacts()[0];
        scope.require.defined(artifact);
        scope.assert.partialDeepEqual(artifact.payload.content, {
            kind: 'text',
            text: '',
            completion: { kind: 'incomplete', reason: 'write-error' }
        });

        return scope.assert.collect();
    }),
    test('failed binary writers refuse further operations and do not add unclosed errors', async (scope) => {
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
        scope.assert.deepEqual(omitted, {
            kind: 'error',
            message: 'Attachment writer is closed.',
            reason: 'operation-error'
        });
        scope.assert.deepEqual(await store.finish(null), []);
        scope.assert.equal(store.artifacts()[0]?.payload.content.kind, 'file');

        return scope.assert.collect();
    }),
    test('resource consumers cannot substitute another runtime variant of a selected case', async (scope) => {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const foreign = { ...work, runtimes: [ { name: 'outside', dimensions: {}, scenarios: {}, variantId: null } ] };
        const response = await store.exchange('test', { kind: 'resource-consumer', boundary: 'owner', work: foreign });
        scope.assert.deepEqual(response, {
            kind: 'error',
            message: 'Resource consumer is outside selected work.',
            reason: 'operation-error'
        });
        scope.assert.deepEqual(store.selectedArtifacts(), []);

        return scope.assert.collect();
    }),
    test('a pending write failure keeps the artifact incomplete when close races it', async (scope: TestScope) => {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const pending = Promise.withResolvers<undefined>();
        const execution = createAttachmentExecution(async function failPendingTransport(operation) {
            if (operation.kind === 'write') {
                await pending.promise;
            }
            return store.exchange('pending', operation);
        }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
        const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });

        const pendingFailureWriting = writer.write('log');
        const pendingFailureRejectedWrite = scope.assert.rejects(async function rejectPendingWrite() {
            await pendingFailureWriting;
        }, { message: 'transport write failed' });
        const pendingFailureClosing = writer.close();
        const pendingFailureRejectedClose = scope.assert.rejects(async function rejectFailedClose() {
            await pendingFailureClosing;
        }, { message: 'transport write failed' });
        pending.reject(new Error('transport write failed'));
        await Promise.all([ pendingFailureRejectedWrite, pendingFailureRejectedClose ]);

        const content = store.artifacts()[0]?.payload.content;
        scope.require.defined(content);
        scope.assert.deepEqual(content, {
            kind: 'text',
            text: '',
            byteLength: 0,
            completion: { kind: 'incomplete', reason: 'write-error' }
        });

        return scope.assert.collect();
    }),
    test('close waits for the pending write and overlapping writes are rejected', async (scope) => {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const pending = Promise.withResolvers<undefined>();
        const execution = createAttachmentExecution(async function waitForWrite(operation) {
            if (operation.kind === 'write') {
                await pending.promise;
            }
            return store.exchange('pending', operation);
        }, { ...defaultAttachmentLimits, maxInlineBytes: 1024 });
        const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });
        const writing = writer.write('one');
        await scope.assert.rejects(async function rejectOverlappingWrite() {
            await writer.write('two');
        }, {
            message: 'Attachment writes require an open writer and an awaited previous write.'
        });
        const closing = writer.close();
        pending.resolve(undefined);
        const [ , artifact ] = await Promise.all([ writing, closing ]);
        scope.assert.deepEqual(artifact.payload.content, {
            kind: 'text',
            text: 'one',
            byteLength: 3,
            completion: { kind: 'complete' }
        });

        return scope.assert.collect();
    }),
    test('binary writers reject strings and writes after close', async (scope) => {
        const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'binary' });
        await scope.assert.rejects(async function rejectTextOnBinary() {
            await Reflect.apply(writer.write, undefined, [ 'text' ]);
        }, { message: 'Binary attachment writers require bytes.' });
        await writer.write(Uint8Array.of(1));
        const artifact = await writer.close();
        await scope.assert.rejects(async function rejectClosedWriter() {
            await writer.write(Uint8Array.of(2));
        }, { message: 'Attachment writes require an open writer and an awaited previous write.' });
        scope.assert.equal(store.artifacts().length, 1);
        scope.assert(assertBinaryContent, artifact);
        const errors = await execution.finish();
        scope.assert.equal(errors.length, 2);

        return scope.assert.collect();
    }),
    suite('file capture copies evidence and preserves overflow failures', [
        test('independent copy', async (scope) => {
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
        test('file overflow', async (scope) => {
            const { execution, directory, store } = await attachmentFixture(scope.cleanup, {
                ...defaultAttachmentLimits,
                maxArtifactBytes: 3
            });
            const source = `${directory}/source.bin`;
            await writeFile(source, Uint8Array.of(4, 5, 6, 7));
            const attachments = execution.context.forProducer({ kind: 'resource', name: 'browser' });
            await scope.assert.rejects(async function rejectOversizedFile() {
                await attachments.file(metadata, source);
            }, { message: 'Binary attachment byte limit exceeded.' });
            await scope.assert(assertFailedWriter, attachments);
            scope.assert.equal(store.artifacts().length, 2);
            const errors = await execution.finish();
            scope.assert.equal(errors.length, 2);

            return scope.assert.collect();
        })
    ]),
    test('JSON descriptors and depth preserve representable values', (scope) => {
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
        const nested: unknown = Array.from({ length: 66 }).reduce<unknown>(function nest(child) {
            return [ child ];
        }, null);
        scope.assert.throws(function rejectDeepJson() {
            snapshotJson(nested, 1024);
        }, { message: 'Attachments require finite, acyclic JSON values with depth at most 64.' });

        return scope.assert.collect();
    }),
    test('invalid metadata and JSON failures remain bounded per attempt', async (scope) => {
        const { execution } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        await execution.runAttempt(work, { index: 0 }, async function rejectInvalidMetadata() {
            const attachments = execution.context.forProducer({ kind: 'case' });
            for (const name of [ '', 'x'.repeat(257), '\u{7F}', '\n' ]) {
                await scope.assert.rejects(async function invalidMetadata() {
                    await attachments.open({ name, mediaType: 'text/plain', kind: 'text' });
                }, { name: 'AttachmentOperationError' });
            }
            for (let index = 0; index < 101; index += 1) {
                await scope.assert.rejects(async function invalidJson() {
                    await attachments.json(metadata, undefined);
                }, { name: 'AttachmentOperationError' });
            }
        });
        scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 100);
        scope.assert.deepEqual(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }), []);

        return scope.assert.collect();
    })
]);
