import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { resourceCheckOwnerSession, completeObservation } from '../test-support/resource-check-session.ts';
import { withResourceCheckCancellation } from '../resource-check-cancellation.ts';
import type { WorkId } from '../engine/identity.ts';

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
export const testNode: TestNode = suite('resource observation stop policy', [
    table({
        title: 'standalone stops close admission exactly once',
        cases: [ 'per-case', 'per-run' ] as const,
        caseTitle(resourceScope) {
            return resourceScope;
        },
        async test(scope) {
            const resourceScope = scope.parameters;

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
    }),
    table({
        title: 'managed shared stops cancel consumers',
        cases: [ 'lifetime', 'attempt' ] as const,
        caseTitle(kind) {
            return kind;
        },
        async test(scope) {
            const kind = scope.parameters;

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
        }
    }),
    test(
        'late stop requests retain evidence without cancelling a closed owner',
        async function (scope) {
            const fixture = resourceCheckOwnerSession(completeObservation, 'per-run', null);
            await fixture.session.install(scope.signal);
            await fixture.session.close(finish);
            const failure = new Error('late failure');
            fixture.context().ledger.requestStop(lifetime, 'owner', { kind: 'observation-error', error: failure });
            scope.assert.deepEqual(fixture.stopped, []);
            scope.assert.equal(fixture.session.snapshots()[0]?.status.kind, 'incomplete');
            return scope.assert.collect();
        }
    )
]);
