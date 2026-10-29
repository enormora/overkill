import { setTimeout as delay } from 'node:timers/promises';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord, historyTimestamp } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import { repairHistory } from './history-repair.ts';
import { readCompactHistory, updateCompactHistory } from './history-storage.ts';

const directory = '/project/state';
const context = { directory, policy: defaultHistoryPolicy, now: historyTimestamp, mode: 'explicit' as const };

export const testNode = suite('history repair failures', [
    test('unresolved records retain their known summary family during repair', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        const record = { ...completedHistoryRecord('known'), status: 'started' as const, facts: null, result: null };
        await updateCompactHistory(store, record, { ...context, testFamily: 'microtest' });
        await store.write(`${directory}/runs/known.json`, JSON.stringify(record));
        const repaired = await repairHistory(store, context);
        const index = await readCompactHistory(store, directory);
        scope.assert.equal(repaired.dataLoss, false);
        scope.assert.equal(index?.summaries[0]?.testFamily, 'microtest');
        scope.assert.equal(index?.cases.length, 0);
        return scope.assert.collect();
    }),
    test('explicit repair recovers corrupt durations and reports the lost history', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        await store.write(`${directory}/duration-history/work-durations.json`, '{');
        await store.write(`${directory}/runs/record.json`, JSON.stringify(completedHistoryRecord('record')));
        const repaired = await repairHistory(store, context);
        scope.assert.equal(repaired.dataLoss, true);
        scope.assert.equal(repaired.diagnostics.length, 1);
        const index = await readCompactHistory(store, directory);
        scope.assert.equal(index?.cases[0]?.counters.passed, 1);
        return scope.assert.collect();
    }),
    test('automatic repair preserves corrupt duration state for explicit recovery', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        const filePath = `${directory}/duration-history/work-durations.json`;
        await store.write(filePath, '{');
        await scope.assert.rejects(async function automaticCorruption() {
            await repairHistory(store, { ...context, mode: 'automatic' });
        }, { message: /overkill history compact/ });
        scope.assert.equal(await store.read(filePath), '{');
        return scope.assert.collect();
    }),
    test('future duration schemas are preserved during explicit repair', async function (scope: TestScope) {
        const store = createMemoryHistoryStorage();
        const filePath = `${directory}/duration-history/work-durations.json`;
        const source = JSON.stringify({ version: 99 });
        await store.write(filePath, source);
        await scope.assert.rejects(async function unsupportedDurationVersion() {
            await repairHistory(store, context);
        }, { name: 'UnsupportedHistoryVersionError' });
        scope.assert.equal(await store.read(filePath), source);
        return scope.assert.collect();
    }),
    test(
        'interrupted records reuse their known family without contributing case outcomes',
        async function (scope: TestScope) {
            const store = createMemoryHistoryStorage();
            const record = { ...completedHistoryRecord('interrupted'), status: 'interrupted', result: null };
            await store.write(`${directory}/runs/interrupted.json`, JSON.stringify(record));
            await repairHistory(store, context);
            const index = await readCompactHistory(store, directory);
            scope.assert.equal(index?.summaries[0]?.status, 'interrupted');
            scope.assert.equal(index?.cases.length, 0);
            return scope.assert.collect();
        }
    ),
    test(
        'unresolved records fail automatic repair and report explicit recovery losses',
        async function (scope: TestScope) {
            const store = createMemoryHistoryStorage();
            const record = { ...completedHistoryRecord('unresolved'), status: 'started', facts: null, result: null };
            await store.write(`${directory}/runs/unresolved.json`, JSON.stringify(record));
            await scope.assert.rejects(async function insufficientIdentity() {
                await repairHistory(store, { ...context, mode: 'automatic' });
            }, { message: /overkill history compact/ });
            const repaired = await repairHistory(store, context);
            scope.assert.equal(repaired.dataLoss, true);
            scope.assert.equal(repaired.diagnostics.length, 1);
            return scope.assert.collect();
        }
    ),
    test('a record disappearing after enumeration aborts repair before publication', async function (scope: TestScope) {
        const memory = createMemoryHistoryStorage();
        const store = {
            ...memory,
            async list() {
                return [ `${directory}/runs/missing.json` ];
            }
        };
        await scope.assert.rejects(async function vanishedRecord() {
            await repairHistory(store, context);
        }, { message: /overkill history compact/ });
        scope.assert.equal(await store.read(`${directory}/history/index.json`), null);
        return scope.assert.collect();
    }),
    test('automatic repair stops when enumeration exhausts its time budget', async function (scope: TestScope) {
        const memory = createMemoryHistoryStorage();
        await memory.write(`${directory}/runs/record.json`, JSON.stringify(completedHistoryRecord('record')));
        const store = {
            ...memory,
            async list(recordDirectory: string) {
                await delay(2100);
                return await memory.list(recordDirectory);
            }
        };
        await scope.assert.rejects(async function exhaustedBudget() {
            await repairHistory(store, { ...context, mode: 'automatic' });
        }, { message: /overkill history compact/ });
        scope.assert.equal(await store.read(`${directory}/history/index.json`), null);
        return scope.assert.collect();
    }),
    ...[ 'null', '42', '{"version":"invalid"}' ].map(function invalidVersion(source) {
        return test(`explicit repair reports malformed schema metadata ${source}`, async function (scope: TestScope) {
            const store = createMemoryHistoryStorage();
            await store.write(`${directory}/history/index.json`, source);
            const repaired = await repairHistory(store, context);
            scope.assert.equal(repaired.dataLoss, true);
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
