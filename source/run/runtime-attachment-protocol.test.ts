import { connect, createServer, type Server, type Socket } from 'node:net';
import { once } from 'node:events';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { createAttachmentServer, type AttachmentServer } from './attachment-server.ts';
import { createAttachmentConnection, type AttachmentConnection } from './attachment-connection.ts';
import {
    attachmentMaxFrameBytes,
    attachmentMaxPendingRequests,
    type AttachmentOperation
} from './attachment-protocol.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const open: Extract<AttachmentOperation, { readonly kind: 'open'; }> = {
    kind: 'open',
    branch: null,
    contentKind: 'text',
    owner: { kind: 'run' },
    producer: { kind: 'case' },
    metadata: { name: 'log', mediaType: 'text/plain' }
};

async function assertChannelInterruption(
    scope: TestScope,
    store: AttachmentFixture['store'],
    writer: number,
    write: AttachmentOperation
): Promise<void> {
    scope.assert.deepEqual(await store.finish('second'), []);
    scope.assert.deepEqual(await store.finish('first'), [ { kind: 'run' } ]);
    scope.assert.deepEqual(await store.finish(null), []);
    scope.assert.deepEqual(await store.exchange('first', write), {
        kind: 'error',
        message: 'Attachment writer is closed.',
        reason: 'operation-error'
    });
    const closed = await store.exchange('first', { kind: 'close', writer, reason: 'complete' });
    scope.assert.equal(closed.kind, 'closed');
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    scope.assert.deepEqual(content, {
        kind: 'text',
        text: 'a',
        byteLength: 1,
        completion: { kind: 'incomplete', reason: 'interrupted' }
    });
}

async function assertOversizedRequest(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const server = await createAttachmentServer(store, defaultAttachmentLimits);
    scope.cleanup(async function finishOversizedRequestServer() {
        await server.finish();
    });
    const socket = connect({ host: '127.0.0.1', port: server.endpoint.port });
    await once(socket, 'connect');
    const disconnected = once(socket, 'close');
    socket.write('x'.repeat(attachmentMaxFrameBytes + 1));
    await disconnected;
    scope.assert.deepEqual(await server.finish(), []);
    scope.assert.deepEqual(store.artifacts(), []);
}
async function assertBoundedServerArtifacts(
    scope: TestScope,
    server: AttachmentServer,
    store: AttachmentFixture['store']
): Promise<void> {
    await server.finish();
    scope.assert.equal(store.artifacts().length, 1);
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    scope.assert.deepEqual(content, {
        kind: 'text',
        text: '',
        byteLength: 0,
        completion: { kind: 'incomplete', reason: 'interrupted' }
    });
}

async function assertServerQueueLimit(scope: TestScope): Promise<void> {
    const limits = { ...defaultAttachmentLimits, maxScopeAttachments: 1 };
    const { store } = await attachmentFixture(scope, limits);
    const server = await createAttachmentServer(store, limits);
    scope.cleanup(async function finishFloodedServer() {
        await server.finish();
    });
    const socket = connect({ host: '127.0.0.1', port: server.endpoint.port });
    await once(socket, 'connect');
    const disconnected = once(socket, 'close');
    socket.write(
        Array
            .from({ length: attachmentMaxPendingRequests + 1 }, function queuedRequest(_value, request) {
                return `${JSON.stringify({ request, token: server.endpoint.token, operation: open })}\n`;
            })
            .join('')
    );
    await disconnected;
    await assertBoundedServerArtifacts(scope, server, store);
}
async function assertWriterIsolation(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const response = await store.exchange('first', open);
    if (response.kind !== 'opened') {
        throw new Error('Expected an attachment writer.');
    }
    const write: AttachmentOperation = {
        kind: 'write',
        writer: response.writer,
        data: Buffer.from('a').toString('base64')
    };
    scope.assert.deepEqual(await store.exchange('second', write), {
        kind: 'error',
        message: 'Unknown attachment writer.',
        reason: 'operation-error'
    });
    await store.exchange('first', write);
    await assertChannelInterruption(scope, store, response.writer, write);
}
async function assertOwnerValidation(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    scope.assert.deepEqual(await store.exchange('test', { ...open, branch: 'unknown' }), {
        kind: 'error',
        message: 'Unknown attachment execution branch.',
        reason: 'operation-error'
    });
    const work = createDefaultWorkId({ file: 'missing.test.ts', params: null, suite: [], title: 'missing' });
    scope.assert.deepEqual(
        await store.exchange('test', { ...open, owner: { kind: 'case', work, attempt: { index: 0 } } }),
        {
            kind: 'error',
            message: 'Attachment owner is outside the selected work.',
            reason: 'operation-error'
        }
    );
    const binary = await store.exchange('test', { ...open, contentKind: 'binary' });
    if (binary.kind !== 'opened') {
        throw new Error('Expected an attachment writer.');
    }
    scope.assert.deepEqual(await store.exchange('test', { kind: 'omit', writer: binary.writer }), {
        kind: 'error',
        message: 'Binary attachments cannot be omitted as JSON.',
        reason: 'operation-error'
    });
    scope.assert.deepEqual(await store.finish(null), [ { kind: 'run' } ]);
}

async function assertInvalidToken(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const server = await createAttachmentServer(store, defaultAttachmentLimits);
    scope.cleanup(async function finishAttachmentServer() {
        await server.finish();
    });
    const connection = createAttachmentConnection({ ...server.endpoint, token: 'wrong' });
    await scope.assert.rejects(async function rejectUnauthenticatedRequest() {
        await connection.exchange(open);
    }, { message: 'Attachment execution boundary disconnected.' });
    await scope.assert.rejects(async function rejectDisconnectedRequest() {
        await connection.exchange(open);
    }, { message: 'Attachment execution boundary disconnected.' });
    scope.assert.deepEqual(store.artifacts(), []);
}

async function listen(server: Server): Promise<number> {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Expected a TCP address.');
    }
    return address.port;
}

async function assertPendingDisconnect(
    scope: TestScope,
    connection: AttachmentConnection,
    socket: Socket
): Promise<void> {
    const pending = Array.from({ length: attachmentMaxPendingRequests }, async function pendingRequest() {
        return connection.exchange(open);
    });
    const settled = Promise.allSettled(pending);
    const overflow = scope.assert.rejects(async function exceedPendingLimit() {
        await connection.exchange(open);
    }, { message: 'Attachment transport request limit exceeded.' });
    await Promise.resolve();
    socket.destroy();
    await overflow;
    const results = await settled;
    scope.assert.equal(
        results
            .filter(function rejected(result) {
                return result.status === 'rejected';
            })
            .length,
        256
    );
}
async function closePeerServer(server: Server): Promise<void> {
    await new Promise<void>(function closePeer(resolve, reject) {
        server.close(function closed(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
async function assertInvalidReply(scope: TestScope, reply: string, message: string): Promise<void> {
    const server = createServer(function receiveRequest(socket) {
        socket.on('data', function corruptReply() {
            socket.write(reply);
        });
    });
    const port = await listen(server);
    const connection = createAttachmentConnection({
        port,
        token: 'test',
        branch: null,
        limits: { ...defaultAttachmentLimits, maxInlineBytes: 1 }
    });
    await scope.assert.rejects(async function rejectMalformedReply() {
        await connection.exchange(open);
    }, { message });
    await closePeerServer(server);
}

async function assertPendingLimit(scope: TestScope): Promise<void> {
    const server = createServer();
    const port = await listen(server);
    const peer = new Promise<Socket>(function acceptPeer(resolve) {
        server.once('connection', resolve);
    });
    const connection = createAttachmentConnection({
        port,
        token: 'test',
        branch: null,
        limits: defaultAttachmentLimits
    });
    await connection.ready;
    await assertPendingDisconnect(scope, connection, await peer);
    await new Promise<void>(function closePeer(resolve, reject) {
        server.close(function closed(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-protocol.test.ts',
    children: ([
        [ 'server request floods disconnect and keep allocation bounded', assertServerQueueLimit ],
        [ 'oversized request frames disconnect without creating artifacts', assertOversizedRequest ],
        [ 'writer channels isolate ownership and interruption', assertWriterIsolation ],
        [ 'unknown owners and incompatible operations are rejected', assertOwnerValidation ],
        [ 'invalid execution tokens close the attachment connection', assertInvalidToken ],
        [ 'pending request limits reject excess work and settle on disconnect', assertPendingLimit ]
    ] as const)
        .map(function protocolCase([ title, check ]) {
            return createTestCase({
                ...definition,
                title,
                async body(scope: TestScope) {
                    await check(scope);
                    return scope.assert.collect();
                }
            });
        })
        .concat([
            createTestCase({
                ...definition,
                title: 'invalid reply JSON fails pending attachment operations',
                async body(scope: TestScope) {
                    await assertInvalidReply(
                        scope,
                        'not-json\n',
                        'Unexpected token \'o\', "not-json" is not valid JSON'
                    );
                    return scope.assert.collect();
                }
            }),
            createTestCase({
                ...definition,
                title: 'oversized reply frames fail pending attachment operations',
                async body(scope: TestScope) {
                    await assertInvalidReply(
                        scope,
                        'x'.repeat(attachmentMaxFrameBytes + 7),
                        'Attachment message exceeded its frame limit.'
                    );
                    return scope.assert.collect();
                }
            })
        ])
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
