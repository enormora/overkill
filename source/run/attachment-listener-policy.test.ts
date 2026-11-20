import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentListener, attachmentListenerScenario } from '../test-support/attachment-listener.ts';
import { listenForAttachments } from './attachment-server.ts';
import { attachmentMaxFrameBytes, attachmentMaxPendingRequests } from './attachment-protocol.ts';

function request(token: string, id: number): string {
    return JSON.stringify({ token, request: id, operation: { kind: 'write', writer: id, data: 'YQ==' } });
}
export const testNode = authoredSuite('attachment listener protocol and shutdown', [
    authoredTest('authenticates requests and acknowledges their original sequence', async function (scope: TestScope) {
        const fixture = attachmentListener(scope, attachmentListenerScenario);
        const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        const channel = fixture.connect();
        const reply = channel.nextReply();
        channel.deliver(request(server.endpoint.token, 42));
        scope.assert.deepEqual<unknown, unknown>(await reply, { request: 42, result: { kind: 'written' } });
        scope.assert.equal(fixture.operations.length, 1);
        scope.assert.deepEqual(await server.finish(), []);
        return scope.assert.collect();
    }),
    authoredTest('finishes the listener only once', async function (scope: TestScope) {
        const fixture = attachmentListener(scope, attachmentListenerScenario);
        const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        await Promise.all([ server.finish(), server.finish() ]);
        scope.assert.deepEqual(fixture.events, [ 'listen', 'close' ]);
        scope.assert.deepEqual(fixture.finished, [ null ]);
        return scope.assert.collect();
    }),
    ...([ 'invalid-token', 'malformed-json', 'invalid-schema' ] as const).map(function (kind) {
        return authoredTest(`closes ${kind} requests without calling storage`, async function (scope: TestScope) {
            const fixture = attachmentListener(scope, attachmentListenerScenario);
            const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
            const channel = fixture.connect();
            const lines = { 'invalid-token': request('wrong', 1), 'malformed-json': '{', 'invalid-schema': '{}' };
            const line = lines[kind];
            channel.deliver(line);
            await channel.closed();
            scope.assert.deepEqual(fixture.operations, []);
            await server.finish();
            return scope.assert.collect();
        });
    }),
    ...([ 'exchange', 'write' ] as const).map(function (stage) {
        return authoredTest(`closes channels after ${stage} failures`, async function (scope: TestScope) {
            const failure = new Error('attachment failed');
            const fixture = attachmentListener(scope, { ...attachmentListenerScenario, [stage]: failure });
            const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
            const channel = fixture.connect();
            channel.deliver(request(server.endpoint.token, 1));
            await channel.closed();
            await server.finish();
            scope.assert.equal(fixture.operations.length, 1);
            return scope.assert.collect();
        });
    }),
    authoredTest('retains abandoned owners when a client disconnects', async function (scope: TestScope) {
        const fixture = attachmentListener(scope, { ...attachmentListenerScenario, abandoned: true });
        const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        const channel = fixture.connect();
        channel.socket.destroy();
        await channel.closed();
        scope.assert.deepEqual(await server.finish(), [ { kind: 'run' } ]);
        scope.assert.true(fixture.finished.some(function (ownerChannel) {
            return ownerChannel !== null;
        }));
        return scope.assert.collect();
    }),
    authoredTest('rejects startup and shutdown failures', async function (scope: TestScope) {
        const failure = new Error('listener failed');
        const fixture = attachmentListener(scope, { ...attachmentListenerScenario, start: failure });
        await scope.assert.rejects(async function () {
            return await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        }, { exact: failure });
        const closing = attachmentListener(scope, { ...attachmentListenerScenario, close: failure });
        const server = await listenForAttachments(closing.store, defaultAttachmentLimits, closing.runtime);
        await scope.assert.rejects(server.finish, { exact: failure });
        return scope.assert.collect();
    }),
    ...([ 'missing', 'path' ] as const).map(function (address) {
        return authoredTest(`rejects an execution address of kind ${address}`, async function (scope: TestScope) {
            const fixture = attachmentListener(scope, { ...attachmentListenerScenario, address });
            await scope.assert.rejects(async function () {
                return await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
            }, { message: 'Attachment server did not obtain an execution address.' });
            return scope.assert.collect();
        });
    }),
    authoredTest('closes channels exceeding the frame byte limit', async function (scope: TestScope) {
        const fixture = attachmentListener(scope, attachmentListenerScenario);
        const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        const channel = fixture.connect();
        channel.deliver('x'.repeat(attachmentMaxFrameBytes + 1));
        await channel.closed();
        scope.assert.deepEqual(fixture.operations, []);
        await server.finish();
        return scope.assert.collect();
    }),
    authoredTest('limits pending requests while preserving queued storage order', async function (scope: TestScope) {
        const fixture = attachmentListener(scope, attachmentListenerScenario);
        const server = await listenForAttachments(fixture.store, defaultAttachmentLimits, fixture.runtime);
        const channel = fixture.connect();
        channel.deliver(
            Array
                .from({ length: attachmentMaxPendingRequests + 1 }, function (_value, index) {
                    return request(server.endpoint.token, index);
                })
                .join('\n')
        );
        await channel.closed();
        await server.finish();
        scope.assert.equal(fixture.operations.length, attachmentMaxPendingRequests);
        scope.assert.deepEqual(
            fixture.operations.map(function (operation) {
                return operation.kind;
            }),
            Array.from({ length: attachmentMaxPendingRequests }, function () {
                return 'write';
            })
        );
        return scope.assert.collect();
    })
]);
