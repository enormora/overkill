import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { createInvocationBudget } from '../run/run.entry-point.ts';
import {
    memoryCampaignClient,
    memoryCampaignEndpoint,
    memoryCampaignSocket
} from '../../test-support/memory-campaign-connection.ts';

import { attachCampaignClient, connectCampaign } from './campaign-client.ts';
import { campaignProtocolVersion } from './campaign-protocol.ts';

export const testNode: TestNode = suite('campaign client protocol ownership', [
    test('correlates requests and releases an idle connection', async function (scope) {
        const fixture = await memoryCampaignClient();
        const first = fixture.client.request({ kind: 'fetch' }, null);
        const second = fixture.client.request({ kind: 'release' }, null);
        fixture.reply(1, { kind: 'accepted' });
        fixture.reply(0, { kind: 'baseline', baseline: null });
        scope.assert.deepEqual(await first, { kind: 'baseline', baseline: null });
        scope.assert.deepEqual(await second, { kind: 'accepted' });
        scope.assert.deepEqual(fixture.sent, [
            {
                kind: 'request',
                version: campaignProtocolVersion,
                token: memoryCampaignEndpoint.token,
                id: 0,
                request: { kind: 'fetch' },
                timeoutMilliseconds: null
            },
            {
                kind: 'request',
                version: campaignProtocolVersion,
                token: memoryCampaignEndpoint.token,
                id: 1,
                request: { kind: 'release' },
                timeoutMilliseconds: null
            }
        ]);
        scope.assert.deepEqual(fixture.ownership, { references: 2, releases: 2 });
        return scope.assert.collect();
    }),
    test('turns remote error replies into invocation failures', async function (scope: TestScope) {
        const fixture = await memoryCampaignClient();
        const request = fixture.client.request({ kind: 'fetch' }, null);
        fixture.reply(0, { kind: 'error', message: 'Remote failure.' });
        let failure: unknown = null;
        try {
            await request;
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Remote failure.');
        return scope.assert.collect();
    }),
    test('rejects every pending request on disconnection', async function (scope) {
        const fixture = await memoryCampaignClient();
        const pending = Promise.allSettled([
            fixture.client.request({ kind: 'fetch' }, null),
            fixture.client.request({ kind: 'fetch' }, null)
        ]);
        fixture.socket.destroy();
        const settled = await pending;
        scope.assert.deepEqual(
            settled.map(function (result) {
                return result.status;
            }),
            [ 'rejected', 'rejected' ]
        );
        for (const result of settled) {
            if (result.status === 'rejected') {
                scope.assert.includes(String(result.reason), 'Campaign IPC disconnected.');
            }
        }
        return scope.assert.collect();
    }),
    test('rejects new requests after disposal', async function (scope: TestScope) {
        const fixture = await memoryCampaignClient();
        fixture.client.dispose();
        let failure: unknown = null;
        try {
            await fixture.client.request({ kind: 'fetch' }, null);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Campaign IPC is unavailable.');
        return scope.assert.collect();
    }),
    test('closes the connection when the owning signal aborts', async function (scope) {
        const fixture = await memoryCampaignClient();
        fixture.controller.abort();
        scope.assert.true(fixture.socket.destroyed);
        scope.assert.deepEqual(fixture.sent, []);
        return scope.assert.collect();
    }),
    test('rejects a connection closed before registration', async function (scope: TestScope) {
        const fixture = memoryCampaignSocket();
        const connected = attachCampaignClient(memoryCampaignEndpoint, AbortSignal.any([]), fixture.socket);
        fixture.socket.destroy();
        let failure: unknown = null;
        try {
            await connected;
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, 'Campaign IPC closed during registration.');
        return scope.assert.collect();
    }),
    test('rejects unknown response identifiers and closes pending requests', async function (scope) {
        const fixture = await memoryCampaignClient();
        const request = fixture.client.request({ kind: 'fetch' }, null);
        fixture.reply(99, { kind: 'accepted' });
        await scope.assert.rejects(async function () {
            await request;
        }, { type: Error, message: 'Campaign IPC disconnected.' });
        scope.assert.true(fixture.socket.destroyed);
        return scope.assert.collect();
    }),
    test('propagates remaining invocation budget in a request', async function (scope) {
        const fixture = await memoryCampaignClient();
        const budget = createInvocationBudget(50, null, fixture.clock);
        scope.cleanup(budget.dispose);
        fixture.clock.advanceByMilliseconds(10);
        const request = fixture.client.request({ kind: 'fetch' }, budget);
        fixture.reply(0, { kind: 'baseline', baseline: null });
        await request;
        scope.assert.equal(Reflect.get(fixture.sent[0] ?? {}, 'timeoutMilliseconds'), 40);
        return scope.assert.collect();
    }),
    test(
        'expires pending requests through cancellation frames and waits for acknowledgement',
        async function (scope) {
            const fixture = await memoryCampaignClient();
            const request = fixture.client.request({ kind: 'fetch' }, null);
            const expired = fixture.client.expireRequests();
            fixture.reply(0, { kind: 'accepted' });
            await Promise.all([ request, expired ]);
            scope.assert.deepEqual(fixture.sent[1], {
                kind: 'cancel',
                version: campaignProtocolVersion,
                token: memoryCampaignEndpoint.token,
                cancel: 0,
                reason: 'deadline'
            });
            return scope.assert.collect();
        }
    ),
    test('rejects an already aborted native connection before opening a socket', async function (scope) {
        const failure = new Error('Cancelled.');
        let caught: unknown = null;
        try {
            await connectCampaign(memoryCampaignEndpoint, AbortSignal.abort(failure));
        } catch (error: unknown) {
            caught = error;
        }
        scope.assert.equal(caught, failure);
        return scope.assert.collect();
    })
]);
