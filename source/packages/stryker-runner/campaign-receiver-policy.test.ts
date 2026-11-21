import { once } from 'node:events';
import { suite, test } from '@overkill-dev/test';

import { campaignReceiverChannel, receiverWorker } from '../../test-support/campaign-receiver.ts';
import { campaignProtocolVersion } from './campaign-protocol.ts';

export const testNode = suite('campaign receiver admission', [
    test('serializes and correlates admitted worker responses', async function (scope) {
        const worker = receiverWorker({ kind: 'baseline', baseline: null });
        const fixture = campaignReceiverChannel(scope.cleanup, worker.worker);
        const response = fixture.nextSent();
        fixture.send(4, null, { kind: 'fetch' });
        scope.assert.deepEqual<unknown, unknown>(await response, {
            version: campaignProtocolVersion,
            id: 4,
            response: { kind: 'baseline', baseline: null }
        });
        scope.assert.deepEqual(worker.events, [ 'fetch' ]);
        return scope.assert.collect();
    }),
    test('cancels the worker before processing release requests', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const fixture = campaignReceiverChannel(scope.cleanup, worker.worker);
        const response = fixture.nextSent();
        fixture.send(0, 100, { kind: 'release' });
        await response;
        scope.assert.deepEqual(worker.events, [ 'cancel', 'release' ]);
        return scope.assert.collect();
    }),
    test('serializes worker exceptions into error responses', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const fixture = campaignReceiverChannel(scope.cleanup, {
            ...worker.worker,
            async respond() {
                throw new Error('Worker failed.');
            }
        });
        const response = fixture.nextSent();
        fixture.send(0, null, { kind: 'fetch' });
        scope.assert.deepEqual<unknown, unknown>(await response, {
            version: campaignProtocolVersion,
            id: 0,
            response: { kind: 'error', message: 'Error: Worker failed.' }
        });
        return scope.assert.collect();
    }),
    test('rejects unauthenticated frames by closing their channel', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const fixture = campaignReceiverChannel(scope.cleanup, worker.worker);
        const closed = new Promise<void>(function (resolve) {
            fixture.socket.once('close', resolve);
        });
        fixture.deliver({
            kind: 'request',
            version: campaignProtocolVersion,
            token: '11111111-1111-4111-8111-111111111111',
            id: 0,
            timeoutMilliseconds: null,
            request: { kind: 'fetch' }
        });
        await closed;
        scope.assert.deepEqual(fixture.sent, []);
        scope.assert.true(worker.events.includes('cancel'));
        return scope.assert.collect();
    }),
    test('expires queued requests before invoking a worker', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const fixture = campaignReceiverChannel(scope.cleanup, worker.worker);
        const response = fixture.nextSent();
        fixture.send(0, 0, { kind: 'fetch' });
        scope.assert.deepEqual<unknown, unknown>(await response, {
            version: campaignProtocolVersion,
            id: 0,
            response: { kind: 'timeout', artifacts: [], data: null }
        });
        scope.assert.deepEqual(worker.events, []);
        return scope.assert.collect();
    }),
    test('delivers deadline cancellation to an active worker', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const started = Promise.withResolvers<undefined>();
        const fixture = campaignReceiverChannel(scope.cleanup, {
            ...worker.worker,
            async respond(_request, signal) {
                started.resolve(undefined);
                await once(signal, 'abort');
                signal.throwIfAborted();
                return { kind: 'accepted' };
            }
        });
        const response = fixture.nextSent();
        fixture.send(0, null, { kind: 'fetch' });
        await started.promise;
        fixture.cancel(0, 'deadline');
        scope.assert.deepEqual<unknown, unknown>(await response, {
            version: campaignProtocolVersion,
            id: 0,
            response: { kind: 'timeout', artifacts: [], data: null }
        });
        return scope.assert.collect();
    }),
    test('preserves ordinary cancellation as an error response', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const started = Promise.withResolvers<undefined>();
        const fixture = campaignReceiverChannel(scope.cleanup, {
            ...worker.worker,
            async respond(_request, signal) {
                started.resolve(undefined);
                await once(signal, 'abort');
                signal.throwIfAborted();
                return { kind: 'accepted' };
            }
        });
        const response = fixture.nextSent();
        fixture.send(0, null, { kind: 'fetch' });
        await started.promise;
        fixture.cancel(0, 'cancelled');
        scope.assert.deepEqual<unknown, unknown>(await response, {
            version: campaignProtocolVersion,
            id: 0,
            response: { kind: 'error', message: 'Error: Invocation cancelled.' }
        });
        return scope.assert.collect();
    }),
    test('closes duplicate request identities without concurrent execution', async function (scope) {
        const worker = receiverWorker({ kind: 'accepted' });
        const started = Promise.withResolvers<undefined>();
        const fixture = campaignReceiverChannel(scope.cleanup, {
            ...worker.worker,
            async respond(_request, signal) {
                started.resolve(undefined);
                await once(signal, 'abort');
                return { kind: 'accepted' };
            }
        });
        const closed = new Promise<void>(function (resolve) {
            fixture.socket.once('close', resolve);
        });
        fixture.send(0, null, { kind: 'fetch' });
        await started.promise;
        fixture.send(0, null, { kind: 'fetch' });
        await closed;
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    })
]);
