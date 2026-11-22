import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, type TestScope, suite, test } from '@overkill-dev/test';

import { createDefaultWorkId } from '../../../engine/identity.ts';
import { withResourceCheckDelivery } from '../../../resource-check-delivery.ts';
import type { ResourceCheckSnapshot } from '../../../resource-check-protocol.ts';
import {
    resourceCheckChannel,
    type ResourceCheckFrame,
    type ResourceCheckEndpoint
} from '../../../run/resource-check-channel.ts';
import { resourceCheckClient, type ResourceCheckClient } from '../../../run/resource-check-client.ts';

const work = createDefaultWorkId({ file: null, suite: [], title: 'active consumer', params: null });
const otherWork = createDefaultWorkId({ file: null, suite: [], title: 'unrelated consumer', params: null });
const oversizedFrameBytes = 1_048_577;
const interval = { kind: 'attempt', work, attempt: { index: 0 } } as const;
type ChannelConnection = {
    readonly server: Server;
    readonly client: ResourceCheckClient;
    readonly socket: Socket;
    readonly endpoint: ResourceCheckEndpoint;
};
type FinalizationResponse = Extract<ResourceCheckFrame, { readonly kind: 'finalized'; }>;
type OwnerChannel = ChannelConnection & {
    readonly send: (frame: ResourceCheckFrame) => void;
    readonly acknowledged: Promise<FinalizationResponse>;
};
function endpointFor(server: Server): ResourceCheckEndpoint {
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Expected a TCP address.');
    }
    return { port: address.port, token: randomUUID() };
}
function attachOwnerChannel(cleanup: TestScope['cleanup'], channel: ChannelConnection): OwnerChannel {
    const acknowledgement = Promise.withResolvers<FinalizationResponse>();
    channel.socket.once('close', function stopWaitingForAcknowledgement() {
        acknowledgement.resolve({
            kind: 'finalized',
            request: 'closed',
            errors: [ 'Owner channel closed before acknowledgement.' ]
        });
    });
    const send = resourceCheckChannel(channel.socket, channel.endpoint.token, function receive(frame) {
        if (frame.kind === 'stop') {
            throw new Error('Owner handler rejected the request.');
        }
        if (frame.kind === 'flush') {
            send({ kind: 'result', request: frame.request, snapshots: [], errors: [] });
        } else if (frame.kind === 'finalized') {
            acknowledgement.resolve(frame);
        }
    });
    cleanup(async function closeChannel() {
        channel.socket.destroy();
        channel.client.socket.destroy();
        await new Promise<void>(function close(resolve) {
            channel.server.close(function closed() {
                resolve();
            });
        });
    });
    return { ...channel, send, acknowledged: acknowledgement.promise };
}
async function ownerChannel(cleanup: TestScope['cleanup']): Promise<OwnerChannel> {
    const accepted = Promise.withResolvers<Socket>();
    const server = createServer(function accept(socket) {
        accepted.resolve(socket);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = endpointFor(server);
    const client = resourceCheckClient(endpoint);
    const socket = await accepted.promise;
    return attachOwnerChannel(cleanup, { server, client, socket, endpoint });
}
function ownerFor(token: string): ResourceCheckSnapshot['owner'] {
    return { run: token, id: 'owner', scope: 'per-run' };
}
const assertFinalizationError = defineMacro(function (title: string, failure: unknown, message: string) {
    return test(title, async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const owner = ownerFor(peer.endpoint.token);
        peer.client.delivery.register(owner, 'service', [ work ], async function cannotFinalize() {
            throw failure;
        });
        peer.send({ kind: 'finalize-owner', request: 'finish', owner, interval });
        const response = await peer.acknowledged;
        scope.assert.deepEqual(response.errors, [ message ]);

        return scope.assert.collect();
    });
});
const rejectLostRequest = defineCompositeAssertion({
    name: 'reject lost request',
    async assert(check, pending: Promise<unknown>) {
        return await check.rejects(async function receivePendingResult() {
            await pending;
        }, { message: /Resource observation channel closed/u });
    }
});
const assertCopiedDelivery = defineCompositeAssertion({
    name: 'copied delivery',
    async assert(check, expected: unknown) {
        const module = new URL('../../../resource-check-delivery.ts?delivery-copy', import.meta.url);
        const copy: unknown = await import(module.href);
        if (typeof copy !== 'object' || copy === null) {
            throw new TypeError('Expected an execution delivery module.');
        }
        const read: unknown = Reflect.get(copy, 'currentResourceCheckDelivery');
        if (typeof read !== 'function') {
            throw new TypeError('Expected a delivery reader.');
        }
        return check.group([ check.equal(Reflect.apply(read, undefined, []), expected) ]);
    }
});
export const testNode = suite('resource check transport client', [
    test('shares active ownership across loaded module copies', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        await withResourceCheckDelivery(peer.client.delivery, async function readCopiedDelivery() {
            await scope.assert(assertCopiedDelivery, peer.client.delivery);
        });
        return scope.assert.collect();
    }),
    test('bounds missing acknowledgements without poisoning later requests', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        await scope.assert.rejects(async function waitForMissingOwner() {
            await peer.client.exchange({ kind: 'finalize', request: 'missing', interval });
        }, { message: /acknowledgement timed out/u });
        const next = await peer.client.exchange({ kind: 'flush', request: 'next' });
        scope.assert.deepEqual(next.errors, []);
        return scope.assert.collect();
    }),
    test('rejects pending requests and cancels consumers when the channel closes', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const causes: unknown[] = [];
        const release = peer.client.delivery.active(interval, function cancelled(cause) {
            causes.push(cause);
        });
        const pending = peer.client.exchange({ kind: 'flush', request: 'flush' });
        const rejection = scope.assert(rejectLostRequest, pending);
        peer.socket.destroy();
        await rejection;
        release();
        scope.assert.true(
            causes[0] instanceof Error && causes[0].message === 'Required resource observation was lost.'
        );
        return scope.assert.collect();
    }),
    test('rejects requests made after a channel has closed', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.socket.destroy();
        await closed;
        await scope.assert(rejectLostRequest, peer.client.exchange({ kind: 'flush', request: 'closed' }));
        return scope.assert.collect();
    }),
    test('cancels only matching work and attempts and accepts lifetime stops', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const causes: unknown[] = [];
        const release = peer.client.delivery.active(interval, function cancelled(cause) {
            causes.push(cause);
        });
        peer.send({ kind: 'cancel', work: otherWork, interval, cause: 'other work' });
        peer.send({ kind: 'cancel', work, interval: { ...interval, attempt: { index: 1 } }, cause: 'other attempt' });
        peer.send({ kind: 'cancel', work, interval: { kind: 'lifetime' }, cause: 'lifetime stop' });
        await peer.client.exchange({ kind: 'flush', request: 'delivery' });
        release();
        scope.assert.deepEqual(causes, [ 'lifetime stop' ]);
        return scope.assert.collect();
    }),
    test('acknowledges unavailable owners as incomplete observation', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        peer.send({ kind: 'finalize-owner', request: 'unknown', owner: ownerFor(peer.endpoint.token), interval });
        const response = await peer.acknowledged;
        scope.assert.deepEqual(response.errors, [ 'Resource owner is unavailable.' ]);
        return scope.assert.collect();
    }),
    assertFinalizationError('acknowledges owner finalization exceptions', new Error('drain failed'), 'drain failed'),
    assertFinalizationError('retains non-error finalization failures', 'drain rejected', 'drain rejected'),
    test('closes channels when a frame handler rejects a request', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.client.delivery.stop(ownerFor(peer.endpoint.token), interval, 'stop');
        await closed;
        scope.assert.true(peer.socket.destroyed);
        return scope.assert.collect();
    }),
    test('closes channels when checkpoints cannot be serialized', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.client.delivery.checkpoint({
            owner: ownerFor(peer.endpoint.token),
            resource: 'service',
            revision: 1,
            interval,
            passing: 0,
            failures: [],
            status: { kind: 'open' },
            get errors(): ResourceCheckSnapshot['errors'] {
                throw new Error('Unreadable observation errors.');
            }
        });
        await closed;
        scope.assert.true(peer.client.socket.destroyed);
        return scope.assert.collect();
    }),
    test('closes channels that receive frames from another execution', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.socket.write(
            `${JSON.stringify({ token: 'wrong execution', frame: { kind: 'flush', request: 'forged' } })}\n`
        );
        await closed;
        scope.assert.true(peer.client.socket.destroyed);
        return scope.assert.collect();
    }),
    test('closes channels that receive an oversized frame', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.socket.write('x'.repeat(oversizedFrameBytes));
        await closed;
        scope.assert.true(peer.client.socket.destroyed);
        return scope.assert.collect();
    }),
    test('closes channels when an outgoing frame exceeds the limit', async function (scope) {
        const peer = await ownerChannel(scope.cleanup);
        const closed = once(peer.client.socket, 'close');
        peer.send({ kind: 'cancel', work, interval, cause: 'x'.repeat(oversizedFrameBytes) });
        await closed;
        scope.assert.true(peer.socket.destroyed);
        return scope.assert.collect();
    })
]);
