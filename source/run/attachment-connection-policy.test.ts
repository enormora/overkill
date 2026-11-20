import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { attachmentChannel, type AttachmentChannel } from '../test-support/attachment-channel.ts';

import { attachmentMaxPendingRequests, type AttachmentResponse } from './attachment-protocol.ts';

const operation = { kind: 'write', writer: 1, data: 'unit' } as const;
async function assertAttachmentQueueRecovery(
    scope: TestScope,
    fixture: AttachmentChannel,
    pending: readonly Promise<AttachmentResponse>[]
): Promise<void> {
    for (let request = 0; request < attachmentMaxPendingRequests; request += 1) {
        fixture.reply({ request, result: { kind: 'written' } });
    }
    const responses = await Promise.all(pending);
    scope.assert.equal(responses.length, attachmentMaxPendingRequests);
    const next = fixture.connection.exchange(operation);
    await Promise.resolve();
    fixture.reply({ request: attachmentMaxPendingRequests, result: { kind: 'written' } });
    scope.assert.deepEqual(await next, { kind: 'written' });
}
export const testNode: TestNode = suite('attachment connection policy', [
    test('waits for connection and correlates replies with numbered requests', async function (scope) {
        const fixture = attachmentChannel(scope);
        const pending = fixture.connection.exchange(operation);
        scope.assert.deepEqual(Array.from(fixture.sent), []);
        fixture.connect();
        await fixture.connection.ready;
        await Promise.resolve();
        scope.assert.deepEqual(fixture.sent, [ { request: 0, token: fixture.endpoint.token, operation } ]);
        fixture.reply({ request: 0, result: { kind: 'written' } });
        scope.assert.deepEqual({ response: await pending, references: fixture.references }, {
            response: { kind: 'written' },
            references: { retained: 1, released: 2 }
        });
        return scope.assert.collect();
    }),
    test('delivers out of order replies to the matching callers', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        const first = fixture.connection.exchange(operation);
        const second = fixture.connection.exchange({ ...operation, writer: 2 });
        await fixture.connection.ready;
        await Promise.resolve();
        fixture.reply({ request: 1, result: { kind: 'opened', writer: 42 } });
        fixture.reply({ request: 0, result: { kind: 'written' } });
        scope.assert.deepEqual({ first: await first, second: await second, references: fixture.references }, {
            first: { kind: 'written' },
            second: { kind: 'opened', writer: 42 },
            references: { retained: 2, released: 2 }
        });
        return scope.assert.collect();
    }),
    test('rejects connection failures with their original error', async function (scope) {
        const fixture = attachmentChannel(scope);
        const failure = new Error('Connect failed.');
        const rejected = scope.assert.rejects(async function () {
            return fixture.connection.ready;
        }, { exact: failure });
        fixture.socket.emit('error', failure);
        await rejected;
        await scope.assert.rejects(async function () {
            return fixture.connection.exchange(operation);
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('rejects all pending and future requests when a channel disconnects', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        const pending = [ fixture.connection.exchange(operation), fixture.connection.exchange(operation) ];
        await fixture.connection.ready;
        const message = 'Attachment execution boundary disconnected.';
        const assertions = pending.map(async function rejectedRequest(request) {
            await scope.assert.rejects(async function () {
                return await request;
            }, { message });
        });
        fixture.socket.destroy();
        await Promise.all(assertions);
        await scope.assert.rejects(async function () {
            return await fixture.connection.exchange(operation);
        }, { message });
        return scope.assert.collect();
    }),
    test('notifies disconnect observers when the connection closes', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        await fixture.connection.ready;
        const disconnected = Promise.withResolvers<undefined>();
        fixture.connection.observeDisconnect(function observeClosed() {
            disconnected.resolve(undefined);
        });
        fixture.connection.close();
        await disconnected.promise;
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    }),
    test('fails pending requests on malformed replies', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        const pending = fixture.connection.exchange(operation);
        const failed = scope.assert.rejects(async function () {
            return pending;
        }, { name: 'SyntaxError' });
        await fixture.connection.ready;
        fixture.deliver('not JSON');
        await failed;
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    }),
    test('bounds pending requests and releases the queue after replies', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        const pending = Array.from(
            { length: attachmentMaxPendingRequests },
            async function () {
                return fixture.connection.exchange(operation);
            }
        );
        await fixture.connection.ready;
        await Promise.resolve();
        await scope.assert.rejects(async function () {
            return fixture.connection.exchange(operation);
        }, {
            message: 'Attachment transport request limit exceeded.'
        });
        await assertAttachmentQueueRecovery(scope, fixture, pending);
        return scope.assert.collect();
    }),
    test('rejects oversized replies and destroys their transport', async function (scope) {
        const fixture = attachmentChannel(scope);
        fixture.connect();
        const pending = fixture.connection.exchange(operation);
        const failed = scope.assert.rejects(async function () {
            return pending;
        }, { message: /Attachment.*limit/v });
        await fixture.connection.ready;
        fixture.deliver('x'.repeat(fixture.endpoint.limits.maxInlineBytes * 6 + 131_073));
        await failed;
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    })
]);
