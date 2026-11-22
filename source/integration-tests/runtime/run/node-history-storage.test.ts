import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, createTestFacade } from '@overkill-dev/test';
import { testWorkspace } from '../../../test-support/test-workspace.ts';

import { defaultHistoryPolicy } from '../../../config/history-policy.ts';
import { createNodeHistoryStorage } from '../../../run/node-history-storage.ts';
import type { HistoryStorage } from '../../../run/history-storage-types.ts';

async function incrementCounter(store: HistoryStorage, filePath: string): Promise<void> {
    await store.withLock(async function updateCounter() {
        const count = Number(await store.read(filePath) ?? 0);
        await delay(10);
        await store.write(filePath, String(count + 1));
    });
}

const assertReleaseOnFailure = defineCompositeAssertion({
    name: 'release on failure',
    async assert(check, store: HistoryStorage) {
        return check.group([
            await check.rejects(async function failedOperation() {
                await store.withLock(async function rejectOperation() {
                    throw new Error('Expected failure');
                });
            }, { message: 'Expected failure' }),
            check.equal(
                await store.withLock(async function () {
                    return 'released';
                }),
                'released'
            )
        ]);
    }
});

const assertRecordEnumeration = defineCompositeAssertion({
    name: 'record enumeration',
    async assert(check, store: HistoryStorage, directory: string) {
        const records = path.join(directory, 'runs');
        const record = path.join(records, 'run.json');
        const initialChecks = check.deepEqual(await store.list(records), []);
        await store.write(record, '{}');
        await store.write(path.join(records, 'unrelated.txt'), 'ignored');
        return check.group([
            initialChecks,
            check.deepEqual(await store.list(records), [ record ]),
            await check.rejects(async function invalidRecordDirectory() {
                await store.list(record);
            }, { code: 'ENOTDIR' })
        ]);
    }
});

async function holdHistoryLock(store: HistoryStorage): Promise<() => Promise<void>> {
    const entered = Promise.withResolvers<undefined>();
    const finished = Promise.withResolvers<undefined>();
    const holding = store.withLock(async function holdLock() {
        entered.resolve(undefined);
        await finished.promise;
    });
    await entered.promise;
    return async function releaseLock() {
        finished.resolve(undefined);
        await holding;
    };
}

const { test } = createTestFacade({ resources: { workspace: testWorkspace } });

export const testNode = suite('history locking', [
    test('failed lease acquisition removes its provisional ownership metadata', async function (scope) {
        const directory = scope.resources.workspace;
        const store = createNodeHistoryStorage(directory, defaultHistoryPolicy);

        await mkdir(path.join(directory, 'active-runs', 'collision.json.lease'), { recursive: true });
        await scope.assert.rejects(async function () {
            return store.beginRun('collision');
        }, { message: 'Lock file is already being held' });
        scope.assert.equal(await store.read(path.join(directory, 'active-runs', 'collision.json')), null);

        return scope.assert.collect();
    }),

    test('independent stores serialize read-modify-write operations', async function (scope) {
        const directory = scope.resources.workspace;
        const first = createNodeHistoryStorage(directory, defaultHistoryPolicy);
        const second = createNodeHistoryStorage(directory, defaultHistoryPolicy);
        const filePath = path.join(directory, 'counter.json');

        await Promise.all([ incrementCounter(first, filePath), incrementCounter(second, filePath) ]);
        scope.assert.equal(await first.read(filePath), '2');

        return scope.assert.collect();
    }),
    test(
        'enumeration distinguishes absent directories, record files, and IO failures',
        async function (scope) {
            const directory = scope.resources.workspace;
            const store = createNodeHistoryStorage(directory, defaultHistoryPolicy);

            await scope.assert(assertRecordEnumeration, store, directory);

            return scope.assert.collect();
        }
    ),
    test('contention times out and a rejected operation releases its lock', async function (scope) {
        const directory = scope.resources.workspace;
        const store = createNodeHistoryStorage(directory, { ...defaultHistoryPolicy, lockTimeoutMilliseconds: 0 });

        const release = await holdHistoryLock(store);
        try {
            await scope.assert.rejects(async function lockAlreadyHeld() {
                await store.withLock(async function () {
                    return undefined;
                });
            }, { message: /already being held/ });
        } finally {
            await release();
        }

        await scope.assert(assertReleaseOnFailure, store);

        return scope.assert.collect();
    })
]);
