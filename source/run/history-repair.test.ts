import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord, historyTimestamp } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { readCompactHistory, updateCompactHistory } from './history-storage.ts';
import { repairHistory } from './history-repair.ts';
import { readDurationState } from './duration-history-storage.ts';

const directory = '/project/state';
const context = { directory, policy: defaultHistoryPolicy, now: historyTimestamp, testFamily: 'microtest' };
const repair = { ...context, mode: 'explicit' as const };

async function assertPrunedHistory(scope: TestScope, store: HistoryStorage): Promise<void> {
    const index = await readCompactHistory(store, directory);
    scope.require.defined(index);
    const summary = index.summaries[0];
    scope.require.defined(summary);
    scope.assert.equal(summary.id, 'pruned');
    scope.assert.equal(summary.replayable, false);
    scope.assert.equal(index.cases[0]?.counters.passed, 1);
}

async function writeLegacyDurationRecord(store: HistoryStorage): Promise<void> {
    const record = completedHistoryRecord('old');
    const entries = record.result.perTest.map(function legacyEntry(result) {
        return {
            work: result.workId,
            observations: [ {
                durationMicroseconds: 10,
                observedAt: historyTimestamp,
                metadata: {
                    profile: 'unit',
                    testFamily: 'microtest',
                    processModel: 'in-process',
                    scheduling: 'serial',
                    workerLifecycle: null
                }
            } ]
        };
    });
    await store.write(
        `${directory}/duration-history/work-durations.json`,
        JSON.stringify({ version: 2, updatedAt: historyTimestamp, entries })
    );
    await store.write(`${directory}/runs/old.json`, JSON.stringify(record));
}

export const testNode = suite('history schema compatibility', [
    test(
        'repair preserves summaries and counters after detailed records are pruned',
        async function (scope: TestScope) {
            const store = createMemoryHistoryStorage();
            await updateCompactHistory(store, completedHistoryRecord('pruned'), context);
            await repairHistory(store, repair);
            await assertPrunedHistory(scope, store);
            return scope.assert.collect();
        }
    ),
    test('future schemas cannot be overwritten even by explicit repair', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        const source = JSON.stringify({ version: 99 });
        await store.write(`${directory}/history/index.json`, source);
        await scope.assert.rejects(async function unsupportedFuture() {
            await repairHistory(store, repair);
        }, { name: 'UnsupportedHistoryVersionError' });
        scope.assert.equal(await store.read(`${directory}/history/index.json`), source);
        return scope.assert.collect();
    }),
    test('older readable schemas repair before the next persisted run is ingested', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        await updateCompactHistory(store, completedHistoryRecord('old'), context);
        const index = await readCompactHistory(store, directory);
        scope.require.defined(index);
        await store.write(`${directory}/history/index.json`, JSON.stringify({ ...index, version: 0 }));
        await updateCompactHistory(store, { ...completedHistoryRecord('new'), status: 'started' }, context);
        const repaired = await readCompactHistory(store, directory);
        scope.assert.equal(repaired?.version, 1);
        scope.assert.equal(repaired?.cases[0]?.counters.passed, 1);
        return scope.assert.collect();
    }),
    test(
        'legacy samples survive migration without being imported twice from older records',
        async function (scope: TestScope) {
            const store = createMemoryHistoryStorage();
            await writeLegacyDurationRecord(store);
            await repairHistory(store, repair);
            const durations = await readDurationState(store, directory, historyTimestamp);
            scope.assert.equal(durations?.entries[0]?.count, 1);
            scope.assert.equal(durations?.entries[0]?.observations.length, 1);
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
