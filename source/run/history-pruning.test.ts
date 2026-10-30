import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createHistory, normalizeConfig, type History } from '../packages/run/run.entry-point.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { readCompactHistory } from './history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';

type PruningProject = { readonly directory: string; readonly history: History; readonly store: HistoryStorage; };
async function withPruningProject(operation: (project: PruningProject) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-pruning-'));
    const config = normalizeConfig({ runtimeStateDir: 'state', history: { detailedRunLimit: 0 } });
    const directory = path.join(root, 'state');
    const history = createHistory({ projectRoot: root, config });
    const store = createNodeHistoryStorage(directory, config.history);
    try {
        await history.compact();
        await operation({ directory, history, store });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

export const testNode = suite('history pruning repair boundaries', [
    test('pruning preserves records with incomplete history commits', async function (scope: TestScope) {
        await withPruningProject(async function pendingCommit({ directory, history, store }) {
            const now = new Date();
            const record = { ...completedHistoryRecord('pending'), startedAt: now.toISOString() };
            const recordPath = path.join(directory, 'runs/pending.json');
            await store.write(recordPath, JSON.stringify(record));
            await scope.assert.rejects(async function () {
                return history.prune({ dryRun: false });
            }, { message: /history compact/u });
            scope.assert.equal(await store.read(recordPath), JSON.stringify(record));
            await history.compact();
            await history.prune({ dryRun: false });
            scope.assert.equal(await store.read(recordPath), null);
        });
        return scope.assert.collect();
    }),
    test('repair preserves outcomes when a run summary cannot be recovered', async function (scope: TestScope) {
        await withPruningProject(async function missingFamily({ directory, history, store }) {
            const now = new Date();
            const record = { ...completedHistoryRecord('unknown-family'), startedAt: now.toISOString(), facts: null };
            const recordPath = path.join(directory, 'runs/unknown-family.json');
            await store.write(recordPath, JSON.stringify(record));
            const repaired = await history.compact();
            scope.assert.equal(repaired.dataLoss, true);
            const index = await readCompactHistory(store, directory);
            scope.assert.equal(index?.cases[0]?.counters.passed, 1);
            await history.prune({ dryRun: false });
            scope.assert.equal(await store.read(recordPath), null);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
