import { type TestNode, suite, test } from '@overkill-dev/test';

import { InvocationDeadlineExceededError } from '../run/run.entry-point.ts';
import { memoryCampaignWorker } from '../../test-support/memory-campaign-worker.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';

import { createCampaignSession, type CampaignWorker } from './campaign-worker.ts';

const { signal } = new AbortController();
async function register(worker: CampaignWorker): Promise<void> {
    await worker.respond({ kind: 'register', root: '/project' }, signal, null);
}
export const testNode: TestNode = suite('campaign worker authority', [
    test('assigns a stable campaign identity to a canonical sandbox', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        const result = await fixture.worker.respond({ kind: 'register', root: '/project/alias' }, signal, null);
        scope.assert.deepEqual(result, { kind: 'registered', campaign: '00000000-0000-4000-8000-000000000000' });
        scope.assert.equal(fixture.campaigns.get('/project'), '00000000-0000-4000-8000-000000000000');
        scope.assert.deepEqual(fixture.calls, [ 'canonicalRoot', 'identify' ]);

        return scope.assert.collect();
    }),
    test('rejects commands before registration', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await scope.assert.rejects(async function () {
            await fixture.worker.respond({ kind: 'fetch' }, signal, null);
        }, { type: Error, message: 'Campaign worker must register first.' });

        return scope.assert.collect();
    }),
    test('rejects repeated registration', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        await scope.assert.rejects(async function () {
            await register(fixture.worker);
        }, { type: Error, message: 'Campaign worker is already registered.' });

        return scope.assert.collect();
    }),
    test('shares a published baseline within one registered sandbox', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        scope.assert.deepEqual(await fixture.worker.respond({ kind: 'fetch' }, signal, null), {
            kind: 'baseline',
            baseline: null
        });
        const { baseline } = mutationCoverageFixture('off');
        scope.assert.deepEqual(await fixture.worker.respond({ kind: 'publish', baseline }, signal, null), {
            kind: 'accepted'
        });
        scope.assert.deepEqual(await fixture.worker.respond({ kind: 'publish', baseline }, signal, null), {
            kind: 'accepted'
        });
        scope.assert.deepEqual(await fixture.worker.respond({ kind: 'fetch' }, signal, null), {
            kind: 'baseline',
            baseline
        });

        return scope.assert.collect();
    }),
    test('rejects conflicting baseline publication', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        await fixture.worker.respond(
            { kind: 'publish', baseline: mutationCoverageFixture('off').baseline },
            signal,
            null
        );
        await scope.assert.rejects(async function () {
            await fixture.worker.respond(
                { kind: 'publish', baseline: mutationCoverageFixture('perTest').baseline },
                signal,
                null
            );
        }, { type: Error, message: 'Conflicting campaign baseline publication.' });

        return scope.assert.collect();
    }),
    test('freezes registered policy once and rejects repeated policy registration', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        const request = { kind: 'resolve-policy', sandbox: fixture.sandbox, settings: { seed: '42' } } as const;
        scope.assert.deepEqual(await fixture.worker.respond(request, signal, null), {
            kind: 'policy',
            policy: fixture.policy
        });
        const repeated = await fixture.worker.respond(request, signal, null);
        scope.assert.equal(repeated.kind, 'failure');
        if (repeated.kind === 'failure') {
            scope.assert.equal(repeated.failure.message, 'Campaign policy registration is invalid.');
        }

        return scope.assert.collect();
    }),
    test('serializes policy initialization failures', async function (scope) {
        const failure = new Error('Policy failed.');
        const fixture = await memoryCampaignWorker.create({ policyFailure: failure });
        await register(fixture.worker);
        const result = await fixture.worker.respond(
            {
                kind: 'resolve-policy',
                sandbox: fixture.sandbox,
                settings: { seed: '42' }
            },
            signal,
            null
        );
        scope.assert.equal(result.kind, 'failure');
        if (result.kind === 'failure') {
            scope.assert.equal(result.failure.message, failure.message);
        }

        return scope.assert.collect();
    }),
    test('returns a timeout for deadline cancellation during policy resolution', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        const controller = new AbortController();
        const deadline = new InvocationDeadlineExceededError();
        const worker = createCampaignSession({
            baselines: new Map(fixture.baselines),
            campaigns: new Map(fixture.campaigns)
        }, {
            ...fixture.runtime,
            async policy() {
                controller.abort(deadline);
                throw deadline;
            }
        });
        await register(worker);
        const result = await worker.respond(
            {
                kind: 'resolve-policy',
                sandbox: fixture.sandbox,
                settings: { seed: '42' }
            },
            controller.signal,
            null
        );
        scope.assert.deepEqual(result, { kind: 'timeout', artifacts: [], data: null });

        return scope.assert.collect();
    }),
    test('reuses the execution session while its authority remains unchanged', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        await fixture.worker.respond(
            { kind: 'resolve-policy', sandbox: fixture.sandbox, settings: { seed: '42' } },
            signal,
            null
        );
        const request = {
            kind: 'invoke',
            session: {
                policy: fixture.policy,
                seed: '42',
                lifecycle: { moduleUrl: 'file:///project/lifecycle.ts', exportName: 'create' }
            },
            data: { value: 1 }
        } as const;
        scope.assert.deepEqual(await fixture.worker.respond(request, signal, 50), {
            kind: 'timeout',
            artifacts: [],
            data: { value: 1 }
        });
        await fixture.worker.respond(request, signal, 40);
        await fixture.worker.respond({ kind: 'release' }, signal, null);
        scope.assert.deepEqual(fixture.calls, [ 'canonicalRoot', 'identify', 'policy', 'execution', 'dispose' ]);
        scope.assert.deepEqual(
            fixture.invocations.map(function (invocation) {
                return invocation.timeoutMilliseconds;
            }),
            [ 50, 40 ]
        );
        return scope.assert.collect();
    }),
    test('disposal cancels further work and releases the active execution session', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        await fixture.worker.respond(
            { kind: 'resolve-policy', sandbox: fixture.sandbox, settings: { seed: '42' } },
            signal,
            null
        );
        await fixture.worker.respond(
            {
                kind: 'invoke',
                session: {
                    policy: fixture.policy,
                    seed: '42',
                    lifecycle: { moduleUrl: 'file:///project/lifecycle.ts', exportName: 'create' }
                },
                data: null
            },
            signal,
            50
        );
        await fixture.worker.dispose();
        scope.assert.deepEqual(fixture.calls, [ 'canonicalRoot', 'identify', 'policy', 'execution', 'dispose' ]);
        await scope.assert.rejects(async function () {
            await fixture.worker.respond({ kind: 'fetch' }, signal, null);
        }, { type: DOMException, message: 'This operation was aborted' });
        return scope.assert.collect();
    }),
    test('cancellation rejects further registered work while allowing release', async function (scope) {
        const fixture = await memoryCampaignWorker.create();
        await register(fixture.worker);
        fixture.worker.cancel();
        await scope.assert.rejects(async function () {
            await fixture.worker.respond({ kind: 'fetch' }, signal, null);
        }, { type: Error });
        scope.assert.deepEqual(await fixture.worker.respond({ kind: 'release' }, signal, null), { kind: 'accepted' });

        return scope.assert.collect();
    })
]);
