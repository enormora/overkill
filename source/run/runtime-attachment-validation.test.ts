import { writeFile, readFile } from 'node:fs/promises';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defaultAttachmentLimits,
    type AttachmentWriter,
    type RuntimeAttachmentArtifact,
    type RuntimeAttachments
} from '../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { snapshotAttachmentJson } from './attachment-json.ts';
import { createAttachmentExecution } from './attachment-execution.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const metadata = { name: 'evidence', mediaType: 'application/octet-stream' };

async function assertPendingFailure(
    scope: TestScope,
    writer: AttachmentWriter<Uint8Array | string>,
    pending: PromiseWithResolvers<undefined>
): Promise<void> {
    const writing = writer.write('log');
    const rejectedWrite = scope.assert.rejects(async function rejectPendingWrite() {
        await writing;
    }, { message: 'transport write failed' });
    const closing = writer.close();
    const rejectedClose = scope.assert.rejects(async function rejectFailedClose() {
        await closing;
    }, { message: 'transport write failed' });
    pending.reject(new Error('transport write failed'));
    await Promise.all([ rejectedWrite, rejectedClose ]);
}
async function assertFailedPendingWrite(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const pending = Promise.withResolvers<undefined>();
    const execution = createAttachmentExecution(async function failPendingTransport(operation) {
        if (operation.kind === 'write') {
            await pending.promise;
        }
        return store.exchange('pending', operation);
    }, 1024);
    const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });
    await assertPendingFailure(scope, writer, pending);
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    scope.assert.deepEqual(content, {
        kind: 'text',
        text: '',
        byteLength: 0,
        completion: { kind: 'incomplete', reason: 'write-error' }
    });
}

async function assertPendingWrite(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const pending = Promise.withResolvers<undefined>();
    const execution = createAttachmentExecution(async function waitForWrite(operation) {
        if (operation.kind === 'write') {
            await pending.promise;
        }
        return store.exchange('pending', operation);
    }, 1024);
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
}

function assertBinaryContent(scope: TestScope, artifact: RuntimeAttachmentArtifact): void {
    if (artifact.payload.content.kind !== 'file') {
        throw new Error('Expected a retained file.');
    }
    scope.assert.equal(artifact.payload.content.byteLength, 1);
    scope.assert.deepEqual(artifact.payload.content.completion, { kind: 'complete' });
}
async function assertWriterContract(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
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
    assertBinaryContent(scope, artifact);
    const errors = await execution.finish();
    scope.assert.equal(errors.length, 2);
}

async function assertIndependentCopy(scope: TestScope): Promise<void> {
    const { execution, directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const source = `${directory}/source.bin`;
    await writeFile(source, Uint8Array.of(1, 2));
    const attachments = execution.context.forProducer({ kind: 'resource', name: 'browser' });
    const copied = await attachments.file(metadata, source);
    await writeFile(source, Uint8Array.of(4, 5, 6, 7));
    if (copied.payload.content.kind !== 'file') {
        throw new Error('Expected a retained file.');
    }
    scope.assert.deepEqual(Array.from(await readFile(copied.payload.content.path)), [ 1, 2 ]);
}
async function assertFailedWriter(scope: TestScope, attachments: RuntimeAttachments): Promise<void> {
    const failedWriter = await attachments.open({ ...metadata, kind: 'binary' });
    for (const chunk of [ Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5) ]) {
        await scope.assert.rejects(async function rejectOverflowWriter() {
            await failedWriter.write(chunk);
        }, { message: 'Binary attachment byte limit exceeded.' });
    }
    await scope.assert.rejects(async function closeFailedWriter() {
        await failedWriter.close();
    }, { message: 'Binary attachment byte limit exceeded.' });
}
async function assertFileOverflow(scope: TestScope): Promise<void> {
    const { execution, directory, store } = await attachmentFixture(scope, {
        ...defaultAttachmentLimits,
        maxArtifactBytes: 3
    });
    const source = `${directory}/source.bin`;
    await writeFile(source, Uint8Array.of(4, 5, 6, 7));
    const attachments = execution.context.forProducer({ kind: 'resource', name: 'browser' });
    await scope.assert.rejects(async function rejectOversizedFile() {
        await attachments.file(metadata, source);
    }, { message: 'Binary attachment byte limit exceeded.' });
    await assertFailedWriter(scope, attachments);
    scope.assert.equal(store.artifacts().length, 2);
    const errors = await execution.finish();
    scope.assert.equal(errors.length, 2);
}

function assertJsonDescriptors(scope: TestScope): void {
    const accessor = Object.defineProperty({}, 'value', {
        enumerable: true,
        get() {
            throw new Error('invoked');
        }
    });
    for (const value of [ accessor, { [Symbol('key')]: true } ]) {
        scope.assert.throws(function rejectInvalidJson() {
            snapshotAttachmentJson(value, 1024);
        }, { name: 'TypeError' });
    }
    const shared = { ready: true };
    const value = { first: shared, second: shared };
    Object.setPrototypeOf(value, null);
    Object.defineProperty(value, 'ignored', { value: undefined });
    scope.assert.equal(
        snapshotAttachmentJson(value, 1024)?.encoded,
        '{"first":{"ready":true},"second":{"ready":true}}'
    );
    const nested: unknown = Array.from({ length: 66 }).reduce<unknown>(function nest(child) {
        return [ child ];
    }, null);
    scope.assert.throws(function rejectDeepJson() {
        snapshotAttachmentJson(nested, 1024);
    }, { message: 'Attachments require finite, acyclic JSON values with depth at most 64.' });
}

async function assertFailureBudget(scope: TestScope): Promise<void> {
    const { execution } = await attachmentFixture(scope, defaultAttachmentLimits);
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
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-validation.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'a pending write failure keeps the artifact incomplete when close races it',
            async body(scope: TestScope) {
                await assertFailedPendingWrite(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'close waits for the pending write and overlapping writes are rejected',
            async body(scope: TestScope) {
                await assertPendingWrite(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'binary writers reject strings and writes after close',
            async body(scope: TestScope) {
                await assertWriterContract(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'file capture copies evidence and preserves overflow failures',
            async body(scope: TestScope) {
                await assertIndependentCopy(scope);
                await assertFileOverflow(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'JSON descriptors and depth preserve representable values',
            body(scope: TestScope) {
                assertJsonDescriptors(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'invalid metadata and JSON failures remain bounded per attempt',
            async body(scope: TestScope) {
                await assertFailureBudget(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
