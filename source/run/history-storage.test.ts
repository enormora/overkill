import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord, historyTimestamp } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import { readCompactHistory, updateCompactHistory } from './history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { repairHistory } from './history-repair.ts';

const directory = '/project/state';
const context = { directory, policy: defaultHistoryPolicy, now: historyTimestamp, testFamily: 'microtest' };
const repair = { ...context, mode: 'explicit' as const };

async function assertOneCommittedSample(scope: TestScope, store: HistoryStorage): Promise<void> {
    const index = await readCompactHistory(store, directory);
    scope.require.defined(index);
    scope.assert.equal(index.cases[0]?.counters.passed, 1);
    scope.assert.equal(index.cases[0]?.observations.length, 1);
    scope.assert.equal(index.durations.entries[0]?.count, 1);
}

function failFirstHistoryWrite(memory: HistoryStorage): HistoryStorage {
    let failed = false;
    return {
        ...memory,
        async write(filePath, content) {
            if (filePath.endsWith('/history/index.json') && !failed) {
                failed = true;
                throw new Error('Disk unavailable');
            }
            await memory.write(filePath, content);
        }
    };
}

export const testNode: TestNode = suite('history persistence', [
    test('checkpoints stay provisional and completion is idempotent', async function (scope) {
        const store = createMemoryHistoryStorage();
        const record = completedHistoryRecord('run');
        await updateCompactHistory(store, { ...record, status: 'started' }, context);
        const provisional = await readCompactHistory(store, directory);
        scope.assert.equal(provisional?.cases.length, 0);
        await updateCompactHistory(store, record, context);
        await updateCompactHistory(store, record, context);
        await assertOneCommittedSample(scope, store);
        return scope.assert.collect();
    }),
    test('interrupted checkpoints never create case or duration observations', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        const record = completedHistoryRecord('run');
        await updateCompactHistory(store, { ...record, status: 'started' }, context);
        await updateCompactHistory(store, { ...record, status: 'interrupted' }, context);
        const state = await readCompactHistory(store, directory);
        scope.assert.equal(state?.summaries[0]?.status, 'interrupted');
        scope.assert.equal(state?.cases.length, 0);
        scope.require.defined(state);
        scope.assert.equal(state.durations.entries.length, 0);
        return scope.assert.collect();
    }),
    test('failed aggregate publication leaves no partial durations or receipt', async function (scope) {
        const store = failFirstHistoryWrite(createMemoryHistoryStorage());
        const record = completedHistoryRecord('run');
        await store.write(`${directory}/runs/run.json`, JSON.stringify(record));
        await scope.assert.rejects(async function interruptedCommit() {
            await updateCompactHistory(store, record, context);
        }, { message: 'Disk unavailable' });
        scope.assert.equal(await readCompactHistory(store, directory), null);
        await repairHistory(store, repair);
        await repairHistory(store, repair);
        await assertOneCommittedSample(scope, store);
        return scope.assert.collect();
    }),
    test('explicit repair reports corrupt-state loss and restores retained records', async function (scope) {
        const store = createMemoryHistoryStorage();
        await store.write(`${directory}/history/index.json`, '{');
        await store.write(`${directory}/runs/run.json`, JSON.stringify(completedHistoryRecord('run')));
        const result = await repairHistory(store, repair);
        const state = await readCompactHistory(store, directory);
        scope.assert.equal(result.dataLoss, true);
        scope.assert.equal(result.rebuiltRunCount, 1);
        scope.assert.equal(result.diagnostics.length, 1);
        scope.assert.equal(state?.summaries[0]?.status, 'passed');
        return scope.assert.collect();
    }),
    test('automatic repair with no retained inputs leaves files untouched', async function (scope) {
        const store = createMemoryHistoryStorage();
        await scope.assert.rejects(async function insufficientRecords() {
            await repairHistory(store, { ...repair, mode: 'automatic' });
        }, { message: /History state is unavailable/ });
        scope.assert.equal(await store.read(`${directory}/history/index.json`), null);
        scope.assert.equal(await store.read(`${directory}/duration-history/work-durations.json`), null);
        return scope.assert.collect();
    }),
    test(
        'malformed retained records fail repair without overwriting current history',
        async function (scope) {
            const store = createMemoryHistoryStorage();
            await updateCompactHistory(store, completedHistoryRecord('run'), context);
            const before = await store.read(`${directory}/history/index.json`);
            await store.write(`${directory}/runs/broken.json`, '{}');
            await scope.assert.rejects(async function malformedRecord() {
                await repairHistory(store, repair);
            }, { message: /History state is unavailable/ });
            scope.assert.equal(await store.read(`${directory}/history/index.json`), before);
            return scope.assert.collect();
        }
    )
]);
