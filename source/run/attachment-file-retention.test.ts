import { suite, test } from '@overkill-dev/test';

import { attachmentFile, attachmentFileScenario } from '../test-support/attachment-file.ts';
import { createFileAttachmentRetention } from './attachment-retention.ts';

export const testNode = suite('attachment file retention', [
    test('handles partial writes and closes a completed attachment exactly once', async function (scope) {
        const fixture = attachmentFile({ ...attachmentFileScenario, maximumWrite: 2 });
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        scope.assert.equal(await retention.retain(Buffer.from('abcdef'), 1024), 6);
        await retention.finish({ kind: 'complete' });
        await retention.finish({ kind: 'complete' });
        scope.assert.deepEqual<unknown, unknown>(retention.content(), {
            kind: 'file',
            path: 'artifacts/data.bin',
            byteLength: 6,
            completion: { kind: 'complete' }
        });
        scope.assert.equal(fixture.content(), 'abcdef');
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'write:2', 'write:2', 'write:2', 'close' ]);
        return scope.assert.collect();
    }),
    test(
        'retains only bytes admitted by the file budget and marks incomplete content',
        async function (scope) {
            const fixture = attachmentFile(attachmentFileScenario);
            const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 3);
            scope.assert.equal(await retention.retain(Buffer.from('abcdef'), 1024), 3);
            await retention.finish({ kind: 'complete' });
            scope.assert.deepEqual<unknown, unknown>(retention.content(), {
                kind: 'file',
                path: 'artifacts/data.bin',
                byteLength: 3,
                completion: { kind: 'incomplete', reason: 'byte-limit' }
            });
            scope.assert.equal(fixture.content(), 'abc');
            return scope.assert.collect();
        }
    ),
    test('honors the remaining scope budget without writing the excess bytes', async function (scope) {
        const fixture = attachmentFile(attachmentFileScenario);
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        scope.assert.equal(await retention.retain(Buffer.from('abcdef'), 1), 1);
        await retention.finish({ kind: 'complete' });
        scope.assert.equal(fixture.content(), 'a');
        scope.assert.deepEqual<unknown, unknown>(retention.content(), {
            kind: 'file',
            path: 'artifacts/data.bin',
            byteLength: 1,
            completion: { kind: 'incomplete', reason: 'byte-limit' }
        });
        return scope.assert.collect();
    }),
    test('rejects stalled file writes and closes failed content', async function (scope) {
        const fixture = attachmentFile({ ...attachmentFileScenario, maximumWrite: 0 });
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        await scope.assert.rejects(async function () {
            return retention.retain(Buffer.from('data'), 1024);
        }, {
            message: 'Attachment file write made no progress.'
        });
        scope.assert.deepEqual<unknown, unknown>(retention.content(), {
            kind: 'file',
            path: 'artifacts/data.bin',
            byteLength: 0,
            completion: { kind: 'incomplete', reason: 'write-error' }
        });
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'write:0', 'close' ]);
        return scope.assert.collect();
    }),
    test('retains successful bytes and error identity when a later write fails', async function (scope) {
        const failure = new Error('Write failed.');
        const fixture = attachmentFile({
            ...attachmentFileScenario,
            maximumWrite: 2,
            failedWrite: 2,
            writeFailure: failure
        });
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        await scope.assert.rejects(async function () {
            return retention.retain(Buffer.from('abcdef'), 1024);
        }, { exact: failure });
        scope.assert.deepEqual<unknown, unknown>(retention.content(), {
            kind: 'file',
            path: 'artifacts/data.bin',
            byteLength: 2,
            completion: { kind: 'incomplete', reason: 'write-error' }
        });
        scope.assert.equal(fixture.content(), 'ab');
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'write:2', 'close' ]);
        return scope.assert.collect();
    }),
    test('normalizes truncated binary completion and rejects JSON omission', async function (scope) {
        const fixture = attachmentFile(attachmentFileScenario);
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        scope.assert.throws(function () {
            retention.omit();
        }, { message: 'Binary attachments cannot be omitted as JSON.' });
        await retention.finish({ kind: 'truncated', reason: 'byte-limit' });
        scope.assert.deepEqual<unknown, unknown>(retention.content(), {
            kind: 'file',
            path: 'artifacts/data.bin',
            byteLength: 0,
            completion: { kind: 'incomplete', reason: 'byte-limit' }
        });
        return scope.assert.collect();
    }),
    test('surfaces file close failures', async function (scope) {
        const failure = new Error('Close failed.');
        const fixture = attachmentFile({ ...attachmentFileScenario, closeFailure: failure });
        const retention = createFileAttachmentRetention(fixture.file, 'artifacts/data.bin', 1024);
        await scope.assert.rejects(async function () {
            return retention.finish({ kind: 'complete' });
        }, { exact: failure });
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'close' ]);
        return scope.assert.collect();
    })
]);
