import { setImmediate as waitForCleanup } from 'node:timers/promises';
import { suite, test } from '@overkill-dev/test';

import type { FailedCheck } from '../../../assertion-protocol/assertion-node-shape.ts';
import type { WorkId } from '../../../engine/identity.ts';
import { stopResourceCheckWork, withResourceCheckCancellation } from '../../../resource-check-cancellation.ts';
import {
    createResourceCheckSession,
    withResourceChecks,
    type ResourceCheckInstallationContext,
    type ResourceCheckObservation,
    type ResourceCheckSession,
    type ResourceCheckSessionControl
} from '../../../resources/resource-checks.ts';
import { defineResource, type AnyResourceDefinition } from '../../../resources/resources.ts';

const lifetime = { kind: 'lifetime' } as const;
const work: WorkId = {
    case: { file: null, suite: [], title: 'observed consumer', params: null },
    runtimes: [],
    workload: null,
    familyVariant: null
};
const sibling: WorkId = { ...work, case: { ...work.case, title: 'unrelated consumer' } };
const attempt = { kind: 'attempt', work, attempt: { index: 0 } } as const;
const failedCheck: FailedCheck = {
    kind: 'leaf',
    id: 'resource-check',
    source: 'assert',
    sourceLocations: [ { kind: 'unknown' } ],
    actual: { kind: 'boolean', value: false },
    expected: { kind: 'boolean', value: true },
    path: [],
    diff: null,
    summary: 'Owner invariant failed'
};
function finish(): void {
    return undefined;
}
const completeObservation: ResourceCheckObservation = {
    prepare: finish,
    finalize() {
        return { kind: 'complete' };
    }
};
const owner = defineResource({
    name: 'owner',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return true;
    },
    dispose: null
});
const sharedOwner = defineResource({
    name: 'shared-owner',
    scope: 'per-run',
    requirements: [],
    dependencies: {},
    acquire() {
        return true;
    },
    dispose: null,
    serializeHandle(handle) {
        return handle;
    },
    deserializeHandle(handle: boolean) {
        return handle;
    }
});
type ObservationFixture = {
    readonly session: ResourceCheckSession;
    readonly context: Promise<ResourceCheckInstallationContext<AnyResourceDefinition>>;
};
function observeOwner(
    resource: AnyResourceDefinition,
    observation: ResourceCheckObservation,
    control: ResourceCheckSessionControl
): ObservationFixture {
    const installed = Promise.withResolvers<ResourceCheckInstallationContext<AnyResourceDefinition>>();
    const observed = withResourceChecks(resource, function (context) {
        installed.resolve(context);
        return observation;
    });
    return { session: createResourceCheckSession(observed, true, control), context: installed.promise };
}
async function admitted(session: ResourceCheckSession): Promise<void> {
    session.assertAdmitted();
}
async function activeConsumers(operation: () => Promise<void>): Promise<readonly string[]> {
    const cancelled: string[] = [];
    await withResourceCheckCancellation(work, { index: 0 }, function () {
        cancelled.push('initial');
    }, async function () {
        await withResourceCheckCancellation(work, { index: 1 }, function () {
            cancelled.push('retry');
        }, async function () {
            await withResourceCheckCancellation(sibling, { index: 0 }, function () {
                cancelled.push('sibling');
            }, operation);
        });
    });
    return cancelled;
}

export const testNode = suite('resource check failure paths', [
    test(
        'fatal installation findings block admission and preserve structured checks',
        async function (scope) {
            const stopped: unknown[] = [];
            const resource = withResourceChecks(owner, function (context) {
                context.ledger.requestStop(lifetime, 'service', { kind: 'check', check: failedCheck });
                return completeObservation;
            });
            const session = createResourceCheckSession(resource, true, {
                kind: 'standalone',
                stop(cause) {
                    stopped.push(cause);
                }
            });
            const [ result ] = await Promise.allSettled([ session.install(scope.signal) ]);
            await session.close(finish);
            scope.assert.equal(result.status, 'rejected');
            scope.assert.deepEqual(stopped, [ failedCheck ]);
            scope.assert.equal(
                JSON.stringify(session.snapshots()[0]?.failures),
                JSON.stringify([ { target: 'service', check: failedCheck } ])
            );
            scope.assert.equal(session.snapshots()[0]?.errors.length, 0);
            return scope.assert.collect();
        }
    ),
    test(
        'shared attempt stops cancel only their consumer and leave the owner admitted',
        async function (scope) {
            const fixture = observeOwner(sharedOwner, completeObservation, {
                kind: 'managed',
                consumers: [ work ]
            });
            await fixture.session.install(scope.signal);
            const context = await fixture.context;
            const cancelled = await activeConsumers(async function () {
                stopResourceCheckWork(work, failedCheck, Symbol('unrelated-run'));
                context.ledger.requestStop(attempt, 'service', { kind: 'check', check: failedCheck });
                fixture.session.assertAdmitted();
            });
            await fixture.session.finalize(attempt);
            await fixture.session.close(finish);
            scope.assert.deepEqual(cancelled, [ 'initial' ]);
            scope.assert.equal(
                JSON.stringify(fixture.session.snapshots()[0]?.failures),
                JSON.stringify([ { target: 'service', check: failedCheck } ])
            );
            return scope.assert.collect();
        }
    ),
    test(
        'shared lifetime stops cancel all owner attempts and reject further admission',
        async function (scope) {
            const fixture = observeOwner(sharedOwner, completeObservation, {
                kind: 'managed',
                consumers: [ work ]
            });
            await fixture.session.install(scope.signal);
            const context = await fixture.context;
            const cancelled = await activeConsumers(async function () {
                context.ledger.requestStop(lifetime, 'service', { kind: 'check', check: failedCheck });
            });
            const [ result ] = await Promise.allSettled([ admitted(fixture.session) ]);
            await fixture.session.close(finish);
            scope.assert.deepEqual(cancelled, [ 'initial', 'retry' ]);
            scope.assert.equal(result.status, 'rejected');
            return scope.assert.collect();
        }
    ),
    test('late stop requests retain evidence after owner closure', async function (scope) {
        const stopped: unknown[] = [];
        const fixture = observeOwner(owner, completeObservation, {
            kind: 'standalone',
            stop(cause) {
                stopped.push(cause);
            }
        });
        await fixture.session.install(scope.signal);
        const context = await fixture.context;
        await fixture.session.close(finish);
        context.ledger.requestStop(lifetime, 'late-service', { kind: 'check', check: failedCheck });
        scope.assert.deepEqual(stopped, []);
        scope.assert.equal(fixture.session.snapshots()[0]?.status.kind, 'incomplete');
        scope.assert.deepEqual({
            target: fixture.session.snapshots()[0]?.errors[0]?.target,
            summary: fixture.session.snapshots()[0]?.failures[0]?.check.summary
        }, { target: 'late-service', summary: failedCheck.summary });
        return scope.assert.collect();
    }),
    test('late cleanup runs after owner closure and retains cleanup failures', async function (scope) {
        const signals: boolean[] = [];
        const fixture = observeOwner(owner, completeObservation, { kind: 'standalone', stop: finish });
        await fixture.session.install(scope.signal);
        const context = await fixture.context;
        await fixture.session.close(finish);
        context.cleanup.defer(function (signal) {
            signals.push(signal.aborted);
        });
        context.cleanup.defer(function (signal) {
            signals.push(signal.aborted);
            throw new Error('late cleanup failed');
        });
        await waitForCleanup();
        scope.assert.deepEqual({ signals, status: fixture.session.snapshots()[0]?.status.kind }, {
            signals: [ false, false ],
            status: 'incomplete'
        });
        return scope.assert.collect();
    }),
    test('aborted acquisition signals do not interrupt owner and observer cleanup', async function (scope) {
        const signals: boolean[] = [];
        const acquisition = new AbortController();
        const fixture = observeOwner(owner, completeObservation, { kind: 'standalone', stop: finish });
        await fixture.session.install(acquisition.signal);
        const context = await fixture.context;
        acquisition.abort();
        context.cleanup.defer(function (signal) {
            signals.push(signal.aborted);
        });
        await fixture.session.close(function (signal) {
            signals.push(signal.aborted);
        });
        scope.assert.deepEqual(signals, [ false, false ]);
        return scope.assert.collect();
    }),
    test(
        'preparation failures preserve owner disposal, finalization, and observer cleanup',
        async function (scope) {
            const events: string[] = [];
            const fixture = observeOwner(owner, {
                prepare() {
                    events.push('prepare');
                    throw new Error('prepare failed');
                },
                finalize() {
                    events.push('finalize');
                    return { kind: 'complete' };
                }
            }, { kind: 'standalone', stop: finish });
            await fixture.session.install(scope.signal);
            const context = await fixture.context;
            context.cleanup.defer(function () {
                events.push('observer-close');
            });
            const [ result ] = await Promise.allSettled([ fixture.session.close(function () {
                events.push('owner-close');
            }) ]);
            scope.assert.equal(result.status, 'rejected');
            scope.assert.deepEqual(events, [ 'prepare', 'owner-close', 'finalize', 'observer-close' ]);
            scope.assert.equal(fixture.session.snapshots()[0]?.status.kind, 'incomplete');
            return scope.assert.collect();
        }
    ),
    test('reported installation errors block admission and clean partial observers', async function (scope) {
        const events: string[] = [];
        const failure = new Error('listener installation failed');
        const resource = withResourceChecks(owner, function (context) {
            context.ledger.error(lifetime, 'listener', failure);
            context.cleanup.defer(function () {
                events.push('observer-close');
            });
            return completeObservation;
        });
        const session = createResourceCheckSession(resource, true, { kind: 'standalone', stop: finish });
        const [ installation ] = await Promise.allSettled([ session.install(scope.signal) ]);
        const [ closure ] = await Promise.allSettled([ session.close(finish) ]);
        scope.assert.deepEqual([ installation.status, closure.status ], [ 'rejected', 'rejected' ]);
        scope.assert.deepEqual(events, [ 'observer-close' ]);
        scope.assert.equal(session.snapshots()[0]?.errors[0]?.cause, failure);
        return scope.assert.collect();
    }),
    test(
        'observation stop requests preserve infrastructure failures during installation',
        async function (scope) {
            const failure = new Error('observation stopped installation');
            const stopped: unknown[] = [];
            const resource = withResourceChecks(owner, function (context) {
                context.ledger.requestStop(lifetime, 'listener', { kind: 'observation-error', error: failure });
                return completeObservation;
            });
            const session = createResourceCheckSession(resource, true, {
                kind: 'standalone',
                stop(cause) {
                    stopped.push(cause);
                }
            });
            const [ installation ] = await Promise.allSettled([ session.install(scope.signal) ]);
            const [ closure ] = await Promise.allSettled([ session.close(finish) ]);
            scope.assert.deepEqual([ installation.status, closure.status ], [ 'rejected', 'rejected' ]);
            scope.assert.equal(session.snapshots()[0]?.errors[0]?.cause, failure);
            scope.assert.deepEqual(stopped, [ failure ]);
            return scope.assert.collect();
        }
    ),
    test('invalid observer callbacks fail installation and preserve owner closure', async function (scope) {
        const closed: string[] = [];
        for (
            const observation of [ { ...completeObservation, prepare: null }, {
                ...completeObservation,
                finalize: null
            } ]
        ) {
            const fixture = observeOwner(owner, observation as unknown as ResourceCheckObservation, {
                kind: 'standalone',
                stop: finish
            });
            const [ installation ] = await Promise.allSettled([ fixture.session.install(scope.signal) ]);
            await Promise.allSettled([ fixture.session.close(function () {
                closed.push('owner-close');
            }) ]);
            scope.assert.equal(installation.status, 'rejected');
            scope.assert.equal(fixture.session.snapshots()[0]?.status.kind, 'incomplete');
        }
        scope.assert.deepEqual(closed, [ 'owner-close', 'owner-close' ]);
        return scope.assert.collect();
    })
]);
