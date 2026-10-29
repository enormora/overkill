import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord, historyTimestamp } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { updateCompactHistory } from './history-storage.ts';
import { readDurationProjection } from './history-reader.ts';

const directory = '/project/state';
const context = { directory, policy: defaultHistoryPolicy, now: historyTimestamp, testFamily: 'microtest' };

async function committedStore(): Promise<HistoryStorage> {
    const store = createMemoryHistoryStorage();
    await updateCompactHistory(store, completedHistoryRecord('completed'), context);
    return store;
}

async function leavePendingCompletion(scope: TestScope, store: HistoryStorage): Promise<void> {
    const record = completedHistoryRecord('pending');
    await updateCompactHistory(store, { ...record, status: 'started' }, context);
    const failing = {
        ...store,
        async write(filePath: string, content: string) {
            if (filePath.endsWith('/history/index.json')) {
                throw new Error('History unavailable');
            }
            await store.write(filePath, content);
        }
    };
    await scope.assert.rejects(async function partialCompletion() {
        await updateCompactHistory(failing, record, context);
    }, { message: 'History unavailable' });
}

export const testNode = suite('history reader', [
    test(
        'placement reads completed observations and excludes provisional completions',
        async function (scope: TestScope) {
            const store = await committedStore();
            await leavePendingCompletion(scope, store);
            const projection = await readDurationProjection(store, directory);
            scope.require.defined(projection);
            scope.assert.equal(projection.entries[0]?.observations.length, 1);
            scope.assert.equal(projection.entries[0]?.observations[0]?.durationMicroseconds, 10);
            return scope.assert.collect();
        }
    ),
    test('recorded duration history requires a readable completion ledger', async function (scope: TestScope) {
        const store = await committedStore();
        const missing = {
            ...store,
            async read(filePath: string) {
                return filePath.endsWith('/history/index.json') ? null : await store.read(filePath);
            }
        };
        await scope.assert.rejects(async function missingLedger() {
            await readDurationProjection(missing, directory);
        }, { message: /overkill history compact/ });
        await store.write(`${directory}/history/index.json`, '{');
        await scope.assert.rejects(async function corruptLedger() {
            await readDurationProjection(store, directory);
        }, { message: /overkill history compact/ });
        return scope.assert.collect();
    }),
    test('IO failures remain runtime-state errors with a repair hint', async function (scope: TestScope) {
        const store = {
            ...createMemoryHistoryStorage(),
            async read() {
                throw new Error('Disk unavailable');
            }
        };
        await scope.assert.rejects(async function unreadableState() {
            await readDurationProjection(store, directory);
        }, { message: /overkill history compact/ });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
