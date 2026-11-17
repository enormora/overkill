import { runIfMain } from '#test-runner';
import { createRoot, createTestPlan, createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { withResource } from '../packages/test/resources.entry-point.ts';
import {
    createManagedResourceAcquirer,
    createManagedStores,
    type ManagedResourceAcquirer,
    type ManagedResourceRecord
} from '../run/resource-lifecycle-session-acquirer.ts';
import type { WorkId } from '../engine/identity.ts';
import {
    resourceCheckRunIdentity,
    stopResourceCheckAttempt,
    withResourceCheckCancellation
} from '../resource-check-cancellation.ts';
import type { ResourceCheckInterval } from '../resource-check-protocol.ts';
import { createResourceCheckLedger } from './resource-check-ledger.ts';
import { createResourceCheckSession, withResourceChecks } from './resource-checks.ts';
import { defineResource } from './resources.ts';

const work: WorkId = {
    case: { file: null, suite: [], title: 'observed case', params: null },
    runtimes: [],
    workload: null,
    familyVariant: null
};

type ManagedObservationFixture = {
    readonly resource: Parameters<ManagedResourceAcquirer['acquire']>[0];
    readonly testCase: Parameters<ManagedResourceAcquirer['acquire']>[1];
    readonly installing: Promise<undefined>;
    readonly admit: (value: undefined) => void;
    readonly acquirer: ManagedResourceAcquirer;
};
async function admittedObservation(acquisition: Promise<ManagedResourceRecord>): Promise<ManagedResourceRecord> {
    const record = await acquisition;
    record.checks?.assertAdmitted();
    return record;
}
function pendingManagedObservation(): ManagedObservationFixture {
    const installing = Promise.withResolvers<undefined>();
    const admission = Promise.withResolvers<undefined>();
    const resource = withResourceChecks(
        defineResource({
            name: 'owner',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return true;
            },
            dispose: null
        }),
        async function () {
            installing.resolve(undefined);
            await admission.promise;
            return {
                prepare() {
                    return undefined;
                },
                finalize() {
                    return { kind: 'complete' };
                }
            };
        }
    );
    const child = createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'consumer',
        annotations: {},
        controls: {},
        body: withResource(resource, function (scope) {
            return scope.assert.collect();
        })
    });
    const plan = createTestPlan(createRoot({ title: 'root', annotations: {}, controls: {}, children: [ child ] }));
    const options = {
        testCases: plan.cases,
        boundaryUseCounts: [],
        projectedResources: { resources: [] },
        timing: null
    };
    return {
        resource,
        testCase: plan.cases[0],
        installing: installing.promise,
        admit: admission.resolve,
        acquirer: createManagedResourceAcquirer(createManagedStores(options), options)
    };
}

async function copiedCancellationMember(): Promise<unknown> {
    const module = new URL('../resource-check-cancellation.ts?cancellation-copy', import.meta.url);
    const copy: unknown = await import(module.href);
    if (typeof copy !== 'object' || copy === null) {
        throw new TypeError('Expected a cancellation module.');
    }
    return Reflect.get(copy, 'stopResourceCheckAttempt');
}
export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'resource check isolation',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'loaded module copies share active cancellation ownership',
            annotations: {},
            controls: {},
            async body(scope) {
                const stop = await copiedCancellationMember();
                if (typeof stop !== 'function') {
                    throw new TypeError('Expected attempt cancellation.');
                }
                const causes: unknown[] = [];
                const run = resourceCheckRunIdentity();
                await withResourceCheckCancellation(work, { index: 0 }, function cancelled(cause) {
                    causes.push(cause);
                }, async function stopCopiedAttempt() {
                    Reflect.apply(stop, undefined, [ work, { index: 0 }, 'shared stop', run ]);
                });
                scope.assert.deepEqual(causes, [ 'shared stop' ]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'concurrent consumers await shared observer admission',
            annotations: {},
            controls: {},
            async body(scope) {
                const fixture = pendingManagedObservation();
                const first = fixture.acquirer.acquire(fixture.resource, fixture.testCase, scope.signal);
                await fixture.installing;
                const second = fixture.acquirer.acquire(fixture.resource, fixture.testCase, scope.signal);
                const admission = admittedObservation(second);
                fixture.admit(undefined);
                const records = await Promise.all([ first, admission ]);
                scope.assert.equal(records[0], records[1]);
                await records[0].checks?.close(function () {
                    records[0].releaseOwner();
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'owner closure drains an empty prepared attempt exactly once',
            annotations: {},
            controls: {},
            async body(scope) {
                const events: string[] = [];
                const resource = withResourceChecks(
                    defineResource({
                        name: 'owner',
                        scope: 'per-case',
                        requirements: [],
                        acquire() {
                            return true;
                        },
                        dispose: null
                    }),
                    function () {
                        return {
                            prepare() {
                                return undefined;
                            },
                            finalize(context) {
                                events.push(context.interval.kind);
                                return { kind: 'complete' };
                            }
                        };
                    }
                );
                const session = createResourceCheckSession(resource, true, { kind: 'managed', consumers: [ work ] });
                const interval: ResourceCheckInterval = { kind: 'attempt', work, attempt: { index: 0 } };
                await session.install(scope.signal);
                await session.prepare(interval);
                await session.close(function () {
                    events.push('owner-close');
                });
                await session.finalize(interval);
                scope.assert.deepEqual(events, [ 'owner-close', 'attempt', 'lifetime' ]);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'late findings retain their interval without entering a retry',
            annotations: {},
            controls: {},
            body(scope) {
                const ledger = createResourceCheckLedger(
                    'owner',
                    function () {
                        return undefined;
                    },
                    { run: 'test-run', id: 'test-owner', scope: 'per-case' },
                    function publish() {
                        return undefined;
                    }
                );
                const first: ResourceCheckInterval = { kind: 'attempt', work, attempt: { index: 0 } };
                const retry: ResourceCheckInterval = { kind: 'attempt', work, attempt: { index: 1 } };
                ledger.writer.record(first, 'page', { kind: 'pass' });
                scope.assert.deepEqual(
                    ledger.finalize(first, { kind: 'complete' }),
                    ledger.finalize(first, { kind: 'incomplete', reasons: [ 'must not replace a finalized outcome' ] })
                );
                ledger.writer.record(retry, 'page', { kind: 'pass' });
                ledger.writer.record(first, 'late-page', { kind: 'pass' });
                scope.assert.deepEqual(
                    ledger.snapshots().map(function retainedEvidence(snapshot) {
                        return {
                            passing: snapshot.passing,
                            errors: snapshot.errors.map(function attribution(error) {
                                return { interval: error.interval, target: error.target };
                            })
                        };
                    }),
                    [
                        { passing: 1, errors: [] },
                        { passing: 1, errors: [] },
                        { passing: 0, errors: [ { interval: first, target: 'late-page' } ] }
                    ]
                );
                scope.assert.equal(ledger.finalize({ kind: 'lifetime' }, { kind: 'complete' }).kind, 'incomplete');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'stop evidence survives independently of the cancellation callback',
            annotations: {},
            controls: {},
            body(scope) {
                const causes: unknown[] = [];
                const ledger = createResourceCheckLedger(
                    'owner',
                    function (cause) {
                        causes.push(cause);
                    },
                    { run: 'test-run', id: 'test-owner', scope: 'per-case' },
                    function publish() {
                        return undefined;
                    }
                );
                const failure = new Error('observer transport failed');
                ledger.writer.requestStop(
                    { kind: 'lifetime' },
                    'page',
                    { kind: 'observation-error', error: failure }
                );
                scope.assert.deepEqual(causes, [ failure ]);
                scope.assert.equal(ledger.snapshots()[0]?.errors[0]?.cause, failure);
                scope.assert.equal(ledger.finalize({ kind: 'lifetime' }, { kind: 'complete' }).kind, 'incomplete');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'cancellation targets only its active attempt and releases registrations',
            annotations: {},
            controls: {},
            async body(scope) {
                const stopped: string[] = [];
                const run = resourceCheckRunIdentity();
                await withResourceCheckCancellation(work, { index: 0 }, function () {
                    stopped.push('first');
                }, async function () {
                    await withResourceCheckCancellation(work, { index: 1 }, function () {
                        stopped.push('retry');
                    }, async function () {
                        stopResourceCheckAttempt(work, { index: 0 }, 'stop', run);
                    });
                    stopResourceCheckAttempt(work, { index: 1 }, 'late stop', run);
                });
                stopResourceCheckAttempt(work, { index: 0 }, 'late stop', run);
                scope.assert.deepEqual(stopped, [ 'first' ]);
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
