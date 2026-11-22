import { connect, createServer, type Server, type Socket } from 'node:net';
import { once } from 'node:events';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { test, suite, type TestScope } from '@overkill-dev/test';

import { createDefaultWorkId } from '../../../engine/identity.ts';
import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { attachmentFixture, type AttachmentFixture } from '../../../test-support/attachment-fixture.ts';
import { createAttachmentServer, type AttachmentServer } from '../../../run/attachment-server.ts';
import { createAttachmentConnection, type AttachmentConnection } from '../../../run/attachment-connection.ts';
import {
    attachmentMaxFrameBytes,
    attachmentMaxPendingRequests,
    type AttachmentEndpoint,
    type AttachmentOperation
} from '../../../run/attachment-protocol.ts';

const open: Extract<AttachmentOperation, { readonly kind: 'open'; }> = {
    kind: 'open',
    branch: null,
    contentKind: 'text',
    owner: { kind: 'run' },
    producer: { kind: 'case' },
    metadata: { name: 'log', mediaType: 'text/plain' }
};

const channelInterruptionChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    store: AttachmentFixture['store'],
    writer: number,
    write: AttachmentOperation
): Promise<CompositeAssertionReturn<'assert'>> {
    const initialChecks = check.group([
        check.deepEqual(await store.finish('second'), []),
        check.deepEqual(await store.finish('first'), [ { kind: 'run' } ]),
        check.deepEqual(await store.finish(null), []),
        check.deepEqual(await store.exchange('first', write), {
            kind: 'error',
            message: 'Attachment writer is closed.',
            reason: 'operation-error'
        })
    ]);
    const closed = await store.exchange('first', { kind: 'close', writer, reason: 'complete' });
    const intermediateChecks = check.equal(closed.kind, 'closed');
    const content = store.artifacts()[0]?.payload.content;
    if (content === undefined) {
        return check.group([ initialChecks, intermediateChecks, check.defined(content) ]);
    }
    return check.group([
        initialChecks,
        intermediateChecks,
        check.defined(content),
        check.deepEqual(content, {
            kind: 'text',
            text: 'a',
            byteLength: 1,
            completion: { kind: 'incomplete', reason: 'interrupted' }
        })
    ]);
};

const assertOversizedRequest = defineCompositeAssertion({
    name: 'oversized request',
    async assert(check, registerCleanup: TestScope['cleanup']) {
        const { store } = await attachmentFixture(registerCleanup, defaultAttachmentLimits);
        const server = await createAttachmentServer(store, defaultAttachmentLimits);
        registerCleanup(async function finishOversizedRequestServer() {
            await server.finish();
        });
        const socket = connect({ host: '127.0.0.1', port: server.endpoint.port });
        await once(socket, 'connect');
        const disconnected = once(socket, 'close');
        socket.write('x'.repeat(attachmentMaxFrameBytes + 1));
        await disconnected;
        return check.group([ check.deepEqual(await server.finish(), []), check.deepEqual(store.artifacts(), []) ]);
    }
});
const boundedServerArtifactsChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    server: AttachmentServer,
    store: AttachmentFixture['store']
): Promise<CompositeAssertionReturn<'assert'>> {
    await server.finish();
    const initialChecks = check.equal(store.artifacts().length, 1);
    const content = store.artifacts()[0]?.payload.content;
    if (content === undefined) {
        return check.group([ initialChecks, check.defined(content) ]);
    }
    return check.group([
        initialChecks,
        check.defined(content),
        check.deepEqual(content, {
            kind: 'text',
            text: '',
            byteLength: 0,
            completion: { kind: 'incomplete', reason: 'interrupted' }
        })
    ]);
};

type PendingAttachmentResponse = {
    readonly store: AttachmentFixture['store'];
    readonly opened: Promise<undefined>;
    readonly release: () => void;
};
function holdAttachmentResponses(store: AttachmentFixture['store']): PendingAttachmentResponse {
    const opened = Promise.withResolvers<undefined>();
    const response = Promise.withResolvers<undefined>();
    return {
        opened: opened.promise,
        release() {
            response.resolve(undefined);
        },
        store: {
            ...store,
            async exchange(channel, operation) {
                const result = await store.exchange(channel, operation);
                opened.resolve(undefined);
                await response.promise;
                return result;
            }
        }
    };
}
async function floodAttachmentChannel(
    socket: Socket,
    endpoint: AttachmentEndpoint,
    opened: Promise<undefined>
): Promise<void> {
    await once(socket, 'connect');
    const disconnected = once(socket, 'close', { signal: AbortSignal.timeout(30_000) });
    socket.write(`${JSON.stringify({ request: 0, token: endpoint.token, operation: open })}\n`);
    await opened;
    socket.write(
        Array
            .from({ length: attachmentMaxPendingRequests }, function queuedRequest(_value, request) {
                return `${JSON.stringify({ request: request + 1, token: endpoint.token, operation: open })}\n`;
            })
            .join('')
    );
    await disconnected;
}
const assertServerQueueLimit = defineCompositeAssertion({
    name: 'server queue limit',
    async assert(check, registerCleanup: TestScope['cleanup']) {
        const limits = { ...defaultAttachmentLimits, maxScopeAttachments: 1 };
        const { store } = await attachmentFixture(registerCleanup, limits);
        const pending = holdAttachmentResponses(store);
        const server = await createAttachmentServer(pending.store, limits);
        registerCleanup(async function finishFloodedServer() {
            pending.release();
            await server.finish();
        });
        const socket = connect({ host: '127.0.0.1', port: server.endpoint.port });
        await floodAttachmentChannel(socket, server.endpoint, pending.opened);
        pending.release();
        return await boundedServerArtifactsChecks(check.annotated('bounded server artifacts'), server, store);
    }
});
const assertWriterIsolation = defineCompositeAssertion({
    name: 'writer isolation',
    async assert(check, registerCleanup: TestScope['cleanup']) {
        const { store } = await attachmentFixture(registerCleanup, defaultAttachmentLimits);
        const response = await store.exchange('first', open);
        if (response.kind !== 'opened') {
            throw new Error('Expected an attachment writer.');
        }
        const write: AttachmentOperation = {
            kind: 'write',
            writer: response.writer,
            data: Buffer.from('a').toString('base64')
        };
        const initialChecksBeforeNextAction = check.deepEqual(await store.exchange('second', write), {
            kind: 'error',
            message: 'Unknown attachment writer.',
            reason: 'operation-error'
        });
        await store.exchange('first', write);
        return check.group([
            initialChecksBeforeNextAction,
            await channelInterruptionChecks(
                check.annotated('channel interruption'),
                store,
                response.writer,
                write
            )
        ]);
    }
});
const assertOwnerValidation = defineCompositeAssertion({
    name: 'owner validation',
    async assert(check, registerCleanup: TestScope['cleanup']) {
        const { store } = await attachmentFixture(registerCleanup, defaultAttachmentLimits);
        const initialChecksBeforeNextAction = check.deepEqual(
            await store.exchange('test', { ...open, branch: 'unknown' }),
            {
                kind: 'error',
                message: 'Unknown attachment execution branch.',
                reason: 'operation-error'
            }
        );
        const work = createDefaultWorkId({ file: 'missing.test.ts', params: null, suite: [], title: 'missing' });
        const intermediateChecksBeforeNextAction = check.deepEqual(
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
        return check.group([
            initialChecksBeforeNextAction,
            intermediateChecksBeforeNextAction,
            check.deepEqual(await store.exchange('test', { kind: 'omit', writer: binary.writer }), {
                kind: 'error',
                message: 'Binary attachments cannot be omitted as JSON.',
                reason: 'operation-error'
            }),
            check.deepEqual(await store.finish(null), [ { kind: 'run' } ])
        ]);
    }
});

const assertInvalidToken = defineCompositeAssertion({
    name: 'invalid token',
    async assert(check, registerCleanup: TestScope['cleanup']) {
        const { store } = await attachmentFixture(registerCleanup, defaultAttachmentLimits);
        const server = await createAttachmentServer(store, defaultAttachmentLimits);
        registerCleanup(async function finishAttachmentServer() {
            await server.finish();
        });
        const connection = createAttachmentConnection({ ...server.endpoint, token: 'wrong' });
        return check.group([
            await check.rejects(async function rejectUnauthenticatedRequest() {
                await connection.exchange(open);
            }, { message: 'Attachment execution boundary disconnected.' }),
            await check.rejects(async function rejectDisconnectedRequest() {
                await connection.exchange(open);
            }, { message: 'Attachment execution boundary disconnected.' }),
            check.deepEqual(store.artifacts(), [])
        ]);
    }
});

async function listen(server: Server): Promise<number> {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Expected a TCP address.');
    }
    return address.port;
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
const assertInvalidReply = defineCompositeAssertion({
    name: 'invalid reply',
    async assert(check, reply: string, message: string) {
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
        const initialChecks = await check.rejects(async function rejectMalformedReply() {
            await connection.exchange(open);
        }, { message });
        await closePeerServer(server);
        return initialChecks;
    }
});

const disconnectedPendingRequests = defineCompositeAssertion({
    name: 'disconnect rejects every bounded pending request',
    async assert(check, connection: AttachmentConnection, socket: Socket) {
        const settled = Promise.allSettled(
            Array.from({ length: attachmentMaxPendingRequests }, function () {
                return connection.exchange(open);
            })
        );
        const overflow = check.rejects(async function () {
            await connection.exchange(open);
        }, { message: 'Attachment transport request limit exceeded.' });
        await Promise.resolve();
        socket.destroy();
        const overflowCheck = await overflow;
        const results = await settled;
        return check.group([
            overflowCheck,
            check.equal(
                results
                    .filter(function (result) {
                        return result.status === 'rejected';
                    })
                    .length,
                256
            )
        ]);
    }
});
export const testNode = suite(
    'Runtime attachment protocol',
    [
        suite('validates ownership and message bounds', [
            test('server request floods disconnect and keep allocation bounded', async function (scope) {
                await scope.assert(assertServerQueueLimit, scope.cleanup);
                return scope.assert.collect();
            }),
            test('oversized request frames disconnect without creating artifacts', async function (scope) {
                await scope.assert(assertOversizedRequest, scope.cleanup);
                return scope.assert.collect();
            }),
            test('writer channels isolate ownership and interruption', async function (scope) {
                await scope.assert(assertWriterIsolation, scope.cleanup);
                return scope.assert.collect();
            }),
            test('unknown owners and incompatible operations are rejected', async function (scope) {
                await scope.assert(assertOwnerValidation, scope.cleanup);
                return scope.assert.collect();
            }),
            test('invalid execution tokens close the attachment connection', async function (scope) {
                await scope.assert(assertInvalidToken, scope.cleanup);
                return scope.assert.collect();
            }),
            test('pending request limits reject excess work and settle on disconnect', async function (scope) {
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
                const pendingDisconnectSocket: Socket = await peer;
                await scope.assert(disconnectedPendingRequests, connection, pendingDisconnectSocket);

                await new Promise<void>(function closePeer(resolve, reject) {
                    server.close(function closed(error) {
                        if (error === undefined) {
                            resolve();
                        } else {
                            reject(error);
                        }
                    });
                });

                return scope.assert.collect();
            })
        ]),

        test({
            title: 'invalid reply JSON fails pending attachment operations',
            async body(scope) {
                await scope.assert(
                    assertInvalidReply,
                    'not-json\n',
                    'Unexpected token \'o\', "not-json" is not valid JSON'
                );
                return scope.assert.collect();
            }
        }),
        test({
            title: 'oversized reply frames fail pending attachment operations',
            async body(scope) {
                await scope.assert(
                    assertInvalidReply,
                    'x'.repeat(attachmentMaxFrameBytes + 7),
                    'Attachment message exceeded its frame limit.'
                );
                return scope.assert.collect();
            }
        })
    ]
);
