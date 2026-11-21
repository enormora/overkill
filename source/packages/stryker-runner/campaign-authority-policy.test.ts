import { test, type TestNode, suite } from '@overkill-dev/test';

import { memoryCampaignWorker } from '../../test-support/memory-campaign-worker.ts';
import { campaignProtocolVersion, campaignRequestSchema } from './campaign-protocol.ts';

const invocation = { kind: 'invoke', data: null } as const;

export const testNode: TestNode = suite('campaign invocation admission', [
    test('rejects execution settings supplied with an invocation', function (scope) {
        const parsed = campaignRequestSchema.safeParse({
            kind: 'request',
            version: campaignProtocolVersion,
            token: '00000000-0000-4000-8000-000000000000',
            id: 0,
            timeoutMilliseconds: 50,
            request: { ...invocation, session: { seed: '43' } }
        });
        scope.assert.equal(parsed.success, false);
        return scope.assert.collect();
    }),
    test('requires a frozen policy before running', async function (scope) {
        const { worker, sandbox, invocations } = await memoryCampaignWorker.create();
        await worker.respond({ kind: 'register', root: sandbox.root }, scope.signal, null);
        await scope.assert.rejects(async function () {
            return await worker.respond(invocation, scope.signal, 50);
        }, { message: 'Campaign execution requires a frozen policy.' });
        scope.assert.equal(invocations.length, 0);
        return scope.assert.collect();
    }),
    test('requires a budget and rejects invocations after release', async function (scope) {
        const { worker, sandbox, invocations } = await memoryCampaignWorker.create();
        await worker.respond({ kind: 'register', root: sandbox.root }, scope.signal, null);
        await worker.respond({ kind: 'resolve-policy', sandbox, settings: { seed: '42' } }, scope.signal, null);
        await scope.assert.rejects(async function () {
            return await worker.respond(invocation, scope.signal, null);
        }, { message: 'Campaign execution requires an invocation budget.' });
        await worker.respond({ kind: 'release' }, scope.signal, null);
        await scope.assert.rejects(async function () {
            return await worker.respond(invocation, scope.signal, 50);
        }, { name: 'AbortError', message: 'This operation was aborted' });
        scope.assert.equal(invocations.length, 0);
        return scope.assert.collect();
    })
]);
