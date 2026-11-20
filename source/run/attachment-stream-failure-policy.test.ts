import { type TestNode, suite, test, testDouble } from '@overkill-dev/test';

import { createAttachmentStream, type AttachmentOperations } from './attachment-writer.ts';
import type { AttachmentResponse } from './attachment-protocol.ts';

function operations(send: AttachmentOperations['send']): AttachmentOperations {
    return {
        owner: { kind: 'run' },
        send,
        fail(message) {
            return new Error(message);
        },
        verify: testDouble.returns(undefined),
        release: testDouble.returns(undefined)
    };
}
export const testNode: TestNode = suite('attachment stream failure admission', [
    test('rejects text chunks supplied to binary streams', async function (scope) {
        const send = testDouble.rejects(new Error('Invalid chunks must not be sent.'));
        const stream = createAttachmentStream(operations(send), 1, 'binary');
        await scope.assert.rejects(async function () {
            await stream.write('invalid');
        }, { message: 'Binary attachment writers require bytes.' });
        scope.assert.equal(send.callCount, 0);
        return scope.assert.collect();
    }),
    test('retains a classified non-Error write failure for subsequent writes', async function (scope) {
        const send = testDouble.rejects(42);
        const stream = createAttachmentStream(operations(send), 1, 'text');
        await scope.assert.rejects(async function () {
            await stream.write('first');
        }, { message: 'Attachment write failed.' });
        await scope.assert.rejects(async function () {
            await stream.write('second');
        }, { message: 'Attachment write failed.' });
        scope.assert.equal(send.callCount, 1);
        return scope.assert.collect();
    }),
    test('settles a failed pending write before requesting close', async function (scope) {
        const pending = Promise.withResolvers<AttachmentResponse>();
        const sent: string[] = [];
        const stream = createAttachmentStream(
            operations(async function (operation) {
                sent.push(operation.kind);
                return operation.kind === 'write' ? await pending.promise : { kind: 'written' };
            }),
            1,
            'text'
        );
        const writing = scope.assert.rejects(async function () {
            await stream.write('data');
        }, { message: 'write rejected' });
        const closing = scope.assert.rejects(async function () {
            await stream.close();
        }, { message: 'Attachment close returned an invalid reply.' });
        pending.reject(new Error('write rejected'));
        await writing;
        await closing;
        scope.assert.deepEqual(sent, [ 'write', 'close' ]);
        return scope.assert.collect();
    })
]);
