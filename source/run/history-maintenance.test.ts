import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    normalizeConfig,
    createHistory,
    type NormalizedConfig,
    type History
} from '../packages/run/run.entry-point.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { maintainHistory } from './history-maintenance.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { withinHistoryMaintenanceBudget, HistoryMaintenanceDeferredError } from './history-maintenance-budget.ts';

async function inProject(operation: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-maintenance-'));
    try {
        await operation(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

type RecordedProject = { readonly config: NormalizedConfig; readonly history: History; readonly target: string; };
async function createRecordedHistory(projectRoot: string): Promise<RecordedProject> {
    const config = normalizeConfig({ history: { detailedRunLimit: 0, automaticMaintenanceBudgetMilliseconds: 5000 } });
    const now = new Date();
    const record = { ...completedHistoryRecord('example'), startedAt: now.toISOString() };
    const target = path.join(projectRoot, '.overkill/runs/example.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(record));
    const history = createHistory({ projectRoot, config });
    await history.compact();
    return { config, history, target };
}

export const testNode = suite('automatic history maintenance', [
    test('lock contention quietly defers at the configured lock timeout', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const config = normalizeConfig({ history: { lockTimeoutMilliseconds: 0 } });
            const store = createNodeHistoryStorage(path.join(projectRoot, '.overkill'), config.history);
            await store.withLock(async function holdProjectLock() {
                scope.assert.deepEqual(await maintainHistory({ projectRoot, config }), []);
            });
        });
        return scope.assert.collect();
    }),
    test('stale lock recovery returns a diagnostic', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const { config } = await createRecordedHistory(projectRoot);
            const lock = path.join(projectRoot, '.overkill/history.lock');
            await mkdir(lock);
            const expired = new Date(0);
            await utimes(lock, expired, expired);
            scope.assert.deepEqual(await maintainHistory({ projectRoot, config }), [
                'Stale history lock was recovered.'
            ]);
        });
        return scope.assert.collect();
    }),
    test('zero budget leaves runtime state absent', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const config = normalizeConfig({ history: { automaticMaintenanceBudgetMilliseconds: 0 } });
            scope.assert.deepEqual(await maintainHistory({ projectRoot, config }), []);
            await scope.assert.rejects(async function () {
                await readFile(path.join(projectRoot, '.overkill/history/index.json'));
            }, { code: 'ENOENT' });
        });
        return scope.assert.collect();
    }),
    test('completed records are pruned without removing their summaries', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const { config, history, target } = await createRecordedHistory(projectRoot);
            scope.assert.deepEqual(await maintainHistory({ projectRoot, config }), []);
            const summaries = await history.list();
            scope.assert.equal(summaries[0]?.replay, 'pruned');
            await scope.assert.rejects(async function () {
                await readFile(target);
            }, { code: 'ENOENT' });
        });
        return scope.assert.collect();
    }),
    test('active ownership quietly defers automatic pruning', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const config = normalizeConfig({});
            const store = createNodeHistoryStorage(path.join(projectRoot, '.overkill'), config.history);
            const release = await store.beginRun('active');
            try {
                scope.assert.deepEqual(await maintainHistory({ projectRoot, config }), []);
            } finally {
                await release();
            }
        });
        return scope.assert.collect();
    }),
    test('missing history returns a repair diagnostic', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const diagnostics = await maintainHistory({ projectRoot, config: normalizeConfig({}) });
            scope.assert.equal(diagnostics.length, 1);
            scope.assert.includes(diagnostics[0] ?? '', 'history compact');
        });
        return scope.assert.collect();
    }),
    test('expired deadlines prevent filesystem mutation', async function (scope: TestScope) {
        await inProject(async function (projectRoot) {
            const config = normalizeConfig({});
            const store = createNodeHistoryStorage(projectRoot, config.history);
            await scope.assert.rejects(async function () {
                await withinHistoryMaintenanceBudget(0, async function () {
                    await store.write(path.join(projectRoot, 'unexpected'), 'value');
                });
            }, { type: HistoryMaintenanceDeferredError });
            await scope.assert.rejects(async function () {
                await readFile(path.join(projectRoot, 'unexpected'));
            }, { code: 'ENOENT' });
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
