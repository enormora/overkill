import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { memoryCampaignWorker } from '../../test-support/memory-campaign-worker.ts';
import type { FrozenMicrotestPolicy } from '../run/run.entry-point.ts';
import type { CampaignWorker } from './campaign-worker.ts';

type CampaignFixture = Awaited<ReturnType<typeof memoryCampaignWorker>>;
type Invocation = Extract<Parameters<CampaignWorker['respond']>[0], { readonly kind: 'invoke'; }>;
type InvalidAuthority = 'authority' | 'budget' | 'root' | 'seed';
const messages = {
    authority: 'Campaign execution conflicts with its frozen policy authority.',
    budget: 'Campaign execution requires an invocation budget.',
    root: 'Isolated execution does not belong to the registered sandbox.',
    seed: 'Campaign execution policy changed.'
};
function invocation(policy: FrozenMicrotestPolicy, seed: string): Invocation {
    return {
        kind: 'invoke',
        session: { policy, seed, lifecycle: { moduleUrl: 'file:///project/lifecycle.ts', exportName: 'create' } },
        data: null
    };
}
async function registeredCampaign(signal: AbortSignal): Promise<CampaignFixture> {
    const fixture = await memoryCampaignWorker(null);
    await fixture.worker.respond({ kind: 'register', root: '/project' }, signal, null);
    await fixture.worker.respond(
        { kind: 'resolve-policy', sandbox: fixture.sandbox, settings: { seed: '42' } },
        signal,
        null
    );
    return fixture;
}
function changedInvocation(fixture: CampaignFixture, mode: InvalidAuthority): Invocation {
    const policies = {
        authority: { ...fixture.policy, runtimeStateDir: 'other' },
        budget: fixture.policy,
        root: { ...fixture.policy, cwd: '/another-project' },
        seed: fixture.policy
    };
    return invocation(policies[mode], mode === 'seed' ? '43' : '42');
}
export const testNode = authoredSuite(
    'campaign invocation admission',
    ([ 'authority', 'budget', 'root', 'seed' ] as const).map(function invalidSession(mode) {
        return test(`rejects changed campaign ${mode}`, async function (scope: TestScope) {
            const fixture = await registeredCampaign(scope.signal);
            if (mode === 'seed') {
                await fixture.worker.respond(invocation(fixture.policy, '42'), scope.signal, 1);
            }
            await scope.assert.rejects(async function () {
                await fixture.worker.respond(
                    changedInvocation(fixture, mode),
                    scope.signal,
                    mode === 'budget' ? null : 1
                );
            }, { message: messages[mode] });
            scope.assert.equal(fixture.invocations.length, mode === 'seed' ? 1 : 0);
            await fixture.worker.dispose();
            return scope.assert.collect();
        });
    })
);
