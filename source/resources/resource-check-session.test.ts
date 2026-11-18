import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { resourceCheckSession, completeObservation } from '../test-support/resource-check-session.ts';
import { testNode as stops } from './resource-observation-stop-policy.test.ts';

const lifetime = { kind: 'lifetime' } as const;
const signal = AbortSignal.any([]);
export const testNode = suite('resource observer session ownership', [
    stops,
    test('installs observers once and admits the owner', async function (scope: TestScope) {
        const fixture = resourceCheckSession(completeObservation);
        scope.assert.throws(fixture.session.assertAdmitted, { message: 'Resource observation is installing.' });
        await Promise.all([ fixture.session.install(signal), fixture.session.install(signal) ]);
        fixture.session.assertAdmitted();
        scope.assert.equal(fixture.context().handle, 42);
        await fixture.session.close(function () {
            return undefined;
        });
        scope.assert.deepEqual(fixture.calls, [ 'install', 'prepare:lifetime', 'finalize:lifetime', 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('finalizes each interval once and returns complete evidence', async function (scope: TestScope) {
        const fixture = resourceCheckSession(completeObservation);
        await fixture.session.install(signal);
        await fixture.session.prepare(lifetime);
        await Promise.all([ fixture.session.finalize(lifetime), fixture.session.finalize(lifetime) ]);
        scope.assert.deepEqual(Array.from(fixture.calls), [ 'install', 'prepare:lifetime', 'finalize:lifetime' ]);
        scope.assert.deepEqual<unknown, unknown>(fixture.session.snapshots()[0]?.status, { kind: 'complete' });
        await fixture.session.close(function () {
            return undefined;
        });
        return scope.assert.collect();
    }),
    test('closes the owner and observer infrastructure once', async function (scope: TestScope) {
        const fixture = resourceCheckSession(completeObservation);
        const disposals: string[] = [];
        await fixture.session.install(signal);
        await Promise.all([
            fixture.session.close(function () {
                disposals.push('dispose');
            }),
            fixture.session.close(function () {
                disposals.push('duplicate');
            })
        ]);
        scope.assert.deepEqual(disposals, [ 'dispose' ]);
        scope.assert.throws(fixture.session.assertAdmitted, { message: 'Resource observation is closed.' });
        scope.assert.deepEqual(fixture.calls, [ 'install', 'prepare:lifetime', 'finalize:lifetime', 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('retains installation failures and releases registered cleanup', async function (scope: TestScope) {
        const fixture = resourceCheckSession({ ...completeObservation, install: new Error('Install failed.') });
        await scope.assert.rejects(async function () {
            await fixture.session.install(signal);
        }, { message: 'Install failed.' });
        scope.assert.throws(fixture.session.assertAdmitted, { message: 'Resource observation is stopped.' });
        await scope.assert.rejects(async function () {
            await fixture.session.close(function () {
                return undefined;
            });
        }, { type: AggregateError });
        scope.assert.deepEqual(fixture.calls, [ 'install', 'cleanup' ]);
        return scope.assert.collect();
    }),
    test('rejects an aborted installation before invoking an observer', async function (scope: TestScope) {
        const fixture = resourceCheckSession(completeObservation);
        await scope.assert.rejects(async function () {
            await fixture.session.install(AbortSignal.abort(new Error('Cancelled.')));
        }, { message: 'Cancelled.' });
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test('continues disposal and cleanup when preparation fails', async function (scope: TestScope) {
        const fixture = resourceCheckSession({ ...completeObservation, prepare: new Error('Preparation failed.') });
        const disposals: string[] = [];
        await fixture.session.install(signal);
        await scope.assert.rejects(async function () {
            await fixture.session.close(function () {
                disposals.push('dispose');
            });
        }, { type: AggregateError });
        scope.assert.deepEqual(disposals, [ 'dispose' ]);
        scope.assert.true(fixture.calls.includes('cleanup'));
        return scope.assert.collect();
    }),
    ...[ { kind: 'incomplete', reasons: [] }, { kind: 'incomplete', reasons: [ 'Missing reply.' ] } ].map(
        function (completeness) {
            return test(
                `rejects incomplete evidence with ${completeness.reasons.length} reasons`,
                async function (scope: TestScope) {
                    const fixture = resourceCheckSession({
                        ...completeObservation,
                        completeness: { ...completeness, kind: 'incomplete' }
                    });
                    await fixture
                        .session
                        .install(signal);
                    await scope.assert.rejects(async function () {
                        await fixture.session.finalize(lifetime);
                    }, { message: 'Resource observation is incomplete.' });
                    scope.assert.deepEqual<unknown, unknown>(fixture.session.snapshots()[0]?.status, {
                        kind: 'incomplete',
                        reasons: completeness.reasons.length === 0
                            ? [ 'Observer reported incomplete observation.' ]
                            : completeness.reasons
                    });
                    return scope.assert.collect();
                }
            );
        }
    ),
    test('retains finalization failures as incomplete evidence', async function (scope: TestScope) {
        const failure = new Error('Finalization failed.');
        const fixture = resourceCheckSession({ ...completeObservation, finalize: failure });
        await fixture.session.install(signal);
        await scope.assert.rejects(async function () {
            await fixture.session.finalize(lifetime);
        }, { message: 'Resource observation is incomplete.' });
        scope.assert.equal(fixture.session.snapshots()[0]?.errors[0]?.cause, failure);
        scope.assert.deepEqual<unknown, unknown>(fixture.session.snapshots()[0]?.status, {
            kind: 'incomplete',
            reasons: [ 'Observation errors were recorded.' ]
        });
        return scope.assert.collect();
    }),
    test('retains cleanup failures after disposing the owner', async function (scope: TestScope) {
        const failure = new Error('Cleanup failed.');
        const fixture = resourceCheckSession({ ...completeObservation, cleanup: failure });
        await fixture.session.install(signal);
        await scope.assert.rejects(async function () {
            await fixture.session.close(function () {
                return undefined;
            });
        }, { message: 'Resource observation closure failed.' });
        scope.assert.equal(fixture.session.snapshots()[0]?.errors[0]?.cause, failure);
        return scope.assert.collect();
    }),
    test('runs cleanup registered after closure', async function (scope: TestScope) {
        const fixture = resourceCheckSession(completeObservation);
        const releases: string[] = [];
        await fixture.session.install(signal);
        await fixture.session.close(function () {
            return undefined;
        });
        fixture.context().cleanup.defer(function () {
            releases.push('late');
        });
        scope.assert.deepEqual(releases, [ 'late' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
