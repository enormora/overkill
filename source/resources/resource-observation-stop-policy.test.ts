import { runIfMain } from '#test-runner';
import { testNode as cancellation } from '../resource-check-cancellation.test.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { resourceCheckOwnerSession, completeObservation } from '../test-support/resource-check-session.ts';
import { withResourceCheckCancellation } from '../resource-check-cancellation.ts';
import type { WorkId } from '../engine/identity.ts';
import { testNode as installation } from './resource-installation-policy.test.ts';
import type { ResourceCheckSession } from './resource-checks.ts';

const work: WorkId = {
    case: { file: null, suite: [], title: 'consumer', params: null },
    runtimes: [],
    workload: null,
    familyVariant: null
};
const lifetime = { kind: 'lifetime' } as const;
const attempt = { kind: 'attempt', work, attempt: { index: 0 } } as const;
function finish(): void {
    return undefined;
}
function assertSharedAdmission(scope: TestScope, session: ResourceCheckSession, kind: 'attempt' | 'lifetime'): void {
    if (kind === 'attempt') {
        session.assertAdmitted();
    } else {
        scope.assert.throws(function () {
            session.assertAdmitted();
        }, { message: 'Resource observation is stopped.' });
    }
}
export const testNode = suite('resource observation stop policy', [
    installation,
    cancellation,
    ...([ 'per-case', 'per-run' ] as const).map(function (resourceScope) {
        return test(
            `standalone ${resourceScope} stop closes admission exactly once`,
            async function (scope: TestScope) {
                const fixture = resourceCheckOwnerSession(completeObservation, resourceScope, null);
                await fixture.session.install(scope.signal);
                const failure = new Error('owner stopped');
                fixture.context().ledger.requestStop(lifetime, 'owner', { kind: 'observation-error', error: failure });
                fixture.context().ledger.requestStop(lifetime, 'owner', { kind: 'observation-error', error: failure });
                scope.assert.deepEqual(fixture.stopped, [ failure ]);
                scope.assert.throws(function () {
                    fixture.session.assertAdmitted();
                }, { message: 'Resource observation is stopped.' });
                await scope.assert.rejects(async function () {
                    await fixture.session.close(finish);
                }, { message: 'Resource observation closure failed.' });
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'lifetime', 'attempt' ] as const).map(function (kind) {
        return test(`managed shared ${kind} stop cancels its consumer`, async function (scope: TestScope) {
            const fixture = resourceCheckOwnerSession(completeObservation, 'per-run', {
                kind: 'managed',
                consumers: [ work ]
            });
            await fixture.session.install(scope.signal);
            const stopped: unknown[] = [];
            const failure = new Error('consumer stopped');
            await withResourceCheckCancellation(work, { index: 0 }, function (cause) {
                stopped.push(cause);
            }, async function () {
                fixture.context().ledger.requestStop(kind === 'lifetime' ? lifetime : attempt, 'owner', {
                    kind: 'observation-error',
                    error: failure
                });
            });

            scope.assert.deepEqual(stopped, [ failure ]);
            assertSharedAdmission(scope, fixture.session, kind);
            await scope.assert.rejects(async function () {
                await fixture.session.close(finish);
            }, { message: 'Resource observation closure failed.' });
            return scope.assert.collect();
        });
    }),
    test('late stop requests retain evidence without cancelling a closed owner', async function (scope: TestScope) {
        const fixture = resourceCheckOwnerSession(completeObservation, 'per-run', null);
        await fixture.session.install(scope.signal);
        await fixture.session.close(finish);
        const failure = new Error('late failure');
        fixture.context().ledger.requestStop(lifetime, 'owner', { kind: 'observation-error', error: failure });
        scope.assert.deepEqual(fixture.stopped, []);
        scope.assert.equal(fixture.session.snapshots()[0]?.status.kind, 'incomplete');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
