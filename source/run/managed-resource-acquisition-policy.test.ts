import { suite, test } from '@overkill-dev/test';

import { captureRejectedError } from '../test-support/captured-error.ts';
import { managedAcquisition, managedDescriptor, managedRecord } from '../test-support/managed-resource-acquisition.ts';
import { defineResource } from '../resources/resources.ts';

import { managedResourceHandle, resourceProjectionRecordsFromStores } from './resource-lifecycle-session-acquirer.ts';
import { runWithLifecycleCase } from './resource-lifecycle-state.ts';

const noProjections = { resources: [] } as const;
export const testNode = suite('managed resource acquisition policy', [
    test('deduplicates acquired handles within the same boundary', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        let acquisitions = 0;
        const resource = managedDescriptor(function () {
            acquisitions += 1;
            return 'handle';
        });
        const first = await fixture.acquire(resource);
        const second = await fixture.acquire(resource);
        scope.assert.equal(first, second);
        scope.assert.deepEqual({ acquisitions, handle: managedResourceHandle(first, resource) }, {
            acquisitions: 1,
            handle: 'handle'
        });
        scope.assert.deepEqual(fixture.stores.records(), [ first ]);
        scope.assert.deepEqual(resourceProjectionRecordsFromStores(fixture.stores), { resources: [] });
        return scope.assert.collect();
    }),
    test('shares an acquisition that is still pending', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        const ready = Promise.withResolvers<string>();
        let acquisitions = 0;
        const resource = managedDescriptor(async function () {
            acquisitions += 1;
            return await ready.promise;
        });
        const first = fixture.acquire(resource);
        const second = fixture.acquire(resource);
        ready.resolve('handle');
        const [ left, right ] = await Promise.all([ first, second ]);
        scope.assert.deepEqual({ sharedHandle: left === right, acquisitions }, { sharedHandle: true, acquisitions: 1 });
        return scope.assert.collect();
    }),
    test('forgets failed acquisitions and permits a retry', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        const error = new Error('unavailable');
        let acquisitions = 0;
        const resource = managedDescriptor(function () {
            acquisitions += 1;
            if (acquisitions === 1) {
                throw error;
            }
            return 'recovered';
        });
        await scope.assert.rejects(async function () {
            await fixture.acquire(resource);
        }, { exact: error });
        const record = await fixture.acquire(resource);
        scope.assert.equal(record.consumerHandle, 'recovered');
        scope.assert.equal(acquisitions, 2);
        return scope.assert.collect();
    }),
    test('rejects distinct descriptors competing for a boundary name', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        await fixture.acquire(managedDescriptor(function () {
            return 'first';
        }));
        const failure = await captureRejectedError(async function () {
            await fixture.acquire(managedDescriptor(function () {
                return 'second';
            }));
        });
        scope.assert.equal(
            failure?.message,
            'Resource name "owner" is used by multiple descriptors in one lifecycle boundary.'
        );
        scope.assert.equal(fixture.stores.records().length, 1);
        return scope.assert.collect();
    }),
    test('acquires dependency handles before their consumers', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        const dependency = managedDescriptor(function () {
            return 'connection';
        });
        const consumer = defineResource({
            name: 'service',
            scope: 'per-case',
            dependencies: { connection: dependency },
            requirements: [],
            dispose: null,
            acquire(context) {
                return { connection: context.dependencies.connection, frozen: Object.isFrozen(context.dependencies) };
            }
        });
        const record = await fixture.acquire(consumer);
        scope.assert.deepEqual<unknown, unknown>(record.consumerHandle, { connection: 'connection', frozen: true });
        scope.assert.equal(fixture.stores.records().length, 2);
        return scope.assert.collect();
    }),
    test('keeps case error queues separate by attempt and drains each queue once', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        fixture.stores.recordCaseError(fixture.testCase, 'first', new Error('failure'));
        await runWithLifecycleCase(fixture.testCase, { index: 2 }, async function () {
            fixture.stores.recordCaseError(fixture.testCase, 'second', null);
        });
        scope.assert.partialDeepEqual(fixture.stores.takeAttemptErrors(fixture.testCase, { index: 0 }), [ {
            attributedToAttempt: { index: 0 },
            message: 'first'
        } ]);
        scope.assert.partialDeepEqual(fixture.stores.takeAttemptErrors(fixture.testCase, { index: 2 }), [ {
            attributedToAttempt: { index: 2 },
            message: 'second'
        } ]);
        scope.assert.deepEqual(fixture.stores.takeAttemptErrors(fixture.testCase, { index: 0 }), []);
        scope.assert.deepEqual(fixture.stores.takePendingRunErrors(), []);
        scope.assert.deepEqual(fixture.stores.takeRunErrors(), []);
        return scope.assert.collect();
    }),
    test('counts remaining boundary uses and supports removing retained records', function (scope) {
        const fixture = managedAcquisition(noProjections);
        const resource = managedDescriptor(function () {
            return 'handle';
        });
        const record = managedRecord(resource, fixture.testCase);
        fixture.stores.rememberRecord('retained', record);
        fixture.stores.rememberAcquisition('retained', Promise.resolve(record));
        scope.assert.deepEqual([
            fixture.stores.remainingBoundaryUses('retained'),
            fixture.stores.remainingBoundaryUses('retained'),
            fixture.stores.remainingBoundaryUses('unknown')
        ], [ 1, 0, -1 ]);
        fixture.stores.deleteRecord('retained');
        fixture.stores.deleteAcquisition('retained');
        scope.assert.deepEqual({
            record: fixture.stores.existingRecord('retained'),
            acquisition: fixture.stores.existingAcquisition('retained'),
            records: fixture.stores.records(),
            checks: fixture.stores.checks()
        }, { record: undefined, acquisition: null, records: [], checks: [] });
        return scope.assert.collect();
    }),
    test('serializes owner handles into transport projections', async function (scope) {
        const fixture = managedAcquisition(noProjections);
        const resource = defineResource({
            name: 'remote',
            scope: 'per-run',
            requirements: [],
            dispose: null,
            acquire() {
                return 'owner';
            },
            serializeHandle(handle) {
                return { value: handle };
            },
            deserializeHandle(payload) {
                return payload;
            }
        });
        const record = await fixture.acquire(resource);
        scope.assert.deepEqual(resourceProjectionRecordsFromStores(fixture.stores), {
            resources: [ { boundaryKey: record.boundary.key, payload: { value: 'owner' } } ]
        });
        return scope.assert.collect();
    }),
    test('restores externally owned handles without acquiring the resource locally', async function (scope) {
        const fixture = managedAcquisition({
            resources: [ { boundaryKey: 'run:remote', payload: { value: 'transport' } } ]
        });
        const resource = defineResource({
            name: 'remote',
            scope: 'per-run',
            requirements: [],
            dispose: null,
            acquire() {
                throw new Error('must not acquire');
            },
            serializeHandle(handle) {
                return handle;
            },
            deserializeHandle(payload) {
                return payload;
            }
        });
        const first = await fixture.acquire(resource);
        const second = await fixture.acquire(resource);
        scope.assert.equal(first, second);
        scope.assert.deepEqual<unknown, unknown>(first.consumerHandle, { value: 'transport' });
        scope.assert.true(first.external);
        scope.assert.equal(first.ownerHandle, null);
        first.releaseOwner();
        return scope.assert.collect();
    })
]);
