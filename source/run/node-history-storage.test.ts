import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';

async function incrementCounter(store: HistoryStorage, filePath: string): Promise<void> {
    await store.withLock(async function updateCounter() {
        const count = Number(await store.read(filePath) ?? 0);
        await delay(10);
        await store.write(filePath, String(count + 1));
    });
}

async function assertContentionTimeout(scope: TestScope, store: HistoryStorage): Promise<void> {
    const entered = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const holding = store.withLock(async function holdLock() {
        entered.resolve(undefined);
        await finish.promise;
    });
    await entered.promise;
    try {
        await scope.assert.rejects(async function lockAlreadyHeld() {
            await store.withLock(async function () {
                return undefined;
            });
        }, { message: /already being held/ });
    } finally {
        finish.resolve(undefined);
        await holding;
    }
}

async function assertReleaseOnFailure(scope: TestScope, store: HistoryStorage): Promise<void> {
    await scope.assert.rejects(async function failedOperation() {
        await store.withLock(async function rejectOperation() {
            throw new Error('Expected failure');
        });
    }, { message: 'Expected failure' });
    scope.assert.equal(
        await store.withLock(async function () {
            return 'released';
        }),
        'released'
    );
}

async function assertRecordEnumeration(scope: TestScope, store: HistoryStorage, directory: string): Promise<void> {
    const records = path.join(directory, 'runs');
    const record = path.join(records, 'run.json');
    scope.assert.deepEqual(await store.list(records), []);
    await store.write(record, '{}');
    await store.write(path.join(records, 'unrelated.txt'), 'ignored');
    scope.assert.deepEqual(await store.list(records), [ record ]);
    await scope.assert.rejects(async function invalidRecordDirectory() {
        await store.list(record);
    }, { code: 'ENOTDIR' });
}

export const testNode = suite('history locking', [
    test('independent stores serialize read-modify-write operations', async function (scope: TestScope) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-'));
        const first = createNodeHistoryStorage(directory, defaultHistoryPolicy);
        const second = createNodeHistoryStorage(directory, defaultHistoryPolicy);
        const filePath = path.join(directory, 'counter.json');
        try {
            await Promise.all([ incrementCounter(first, filePath), incrementCounter(second, filePath) ]);
            scope.assert.equal(await first.read(filePath), '2');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
        return scope.assert.collect();
    }),
    test(
        'enumeration distinguishes absent directories, record files, and IO failures',
        async function (scope: TestScope) {
            const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-'));
            const store = createNodeHistoryStorage(directory, defaultHistoryPolicy);
            try {
                await assertRecordEnumeration(scope, store, directory);
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
            return scope.assert.collect();
        }
    ),
    test('contention times out and a rejected operation releases its lock', async function (scope: TestScope) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-'));
        const store = createNodeHistoryStorage(directory, { ...defaultHistoryPolicy, lockTimeoutMilliseconds: 0 });
        try {
            await assertContentionTimeout(scope, store);
            await assertReleaseOnFailure(scope, store);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
