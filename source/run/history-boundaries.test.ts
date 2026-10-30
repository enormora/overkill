import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { createHistory, normalizeConfig, type History } from '../packages/run/run.entry-point.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { readCompactHistory } from './history-storage.ts';
import type { HistoryStorage } from './history-storage-types.ts';

type Project = {
    readonly root: string;
    readonly directory: string;
    readonly history: History;
    readonly store: HistoryStorage;
};
async function withProject(operation: (project: Project) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-boundaries-'));
    const directory = path.join(root, 'state');
    const config = normalizeConfig({ runtimeStateDir: 'state' });
    const history = createHistory({ projectRoot: root, config });
    const store = createNodeHistoryStorage(directory, config.history);
    try {
        await history.compact();
        await operation({ root, directory, history, store });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
async function requiredIndex(project: Project): Promise<NonNullable<Awaited<ReturnType<typeof readCompactHistory>>>> {
    const index = await readCompactHistory(project.store, project.directory);
    if (index === null) {
        throw new Error('Expected compact history.');
    }
    return index;
}
function freshRecord(id: string): ReturnType<typeof completedHistoryRecord> {
    const now = new Date();
    return { ...completedHistoryRecord(id), startedAt: now.toISOString() };
}
async function assertUnavailable(scope: TestScope, history: History): Promise<void> {
    const listed = await history.list();
    scope.assert.equal(listed[0]?.replay, 'unavailable');
}
export const testNode = suite('history maintenance boundaries', [
    test('prune rejects artifact identities that disagree with their directory', async function (scope: TestScope) {
        await withProject(async function mismatchedArtifact({ directory, history, store }) {
            const record = freshRecord('example');
            const recordPath = path.join(directory, 'runs/example.json');
            await store.write(recordPath, JSON.stringify(record));
            await store.write(
                path.join(directory, 'runs/example/retention.json'),
                JSON.stringify({
                    version: 1,
                    id: 'other',
                    startedAt: record.startedAt,
                    status: 'passed'
                })
            );
            await history.compact();
            await scope.assert.rejects(async function () {
                return history.prune({ dryRun: false });
            }, { message: /Artifact identity does not match path/u });
            scope.assert.equal(await store.read(recordPath), JSON.stringify(record));
        });
        return scope.assert.collect();
    }),
    test('prune rejects record identities that disagree with their filename', async function (scope: TestScope) {
        await withProject(async function mismatchedRecord({ directory, history, store }) {
            const recordPath = path.join(directory, 'runs/wrong.json');
            const source = JSON.stringify(freshRecord('example'));
            await store.write(recordPath, source);
            await scope.assert.rejects(async function () {
                return history.prune({ dryRun: false });
            }, { message: /Record identity does not match path/u });
            scope.assert.equal(await store.read(recordPath), source);
        });
        return scope.assert.collect();
    }),
    test('expired records can be pruned after their completion receipts expire', async function (scope: TestScope) {
        await withProject(async function expiredRecord({ root, directory, store }) {
            const record = { ...freshRecord('expired'), startedAt: '2000-01-01T00:00:00.000Z' };
            const recordPath = path.join(directory, 'runs/expired.json');
            await store.write(recordPath, JSON.stringify(record));
            const history = createHistory({
                projectRoot: root,
                config: normalizeConfig({ runtimeStateDir: 'state', history: { detailedRunLimit: 0 } })
            });
            const result = await history.prune({ dryRun: false });
            scope.assert.deepEqual(result.paths, [ recordPath ]);
            scope.assert.equal(await store.read(recordPath), null);
        });
        return scope.assert.collect();
    }),
    test('prune leaves unrelated files in the runs directory untouched', async function (scope: TestScope) {
        await withProject(async function unrelatedFile({ directory, history, store }) {
            const notePath = path.join(directory, 'runs/notes.txt');
            await store.write(notePath, 'keep');
            const result = await history.prune({ dryRun: false });
            scope.assert.deepEqual(result.paths, []);
            scope.assert.equal(await store.read(notePath), 'keep');
        });
        return scope.assert.collect();
    }),
    test('list orders equal timestamps by run identity', async function (scope: TestScope) {
        await withProject(async function tiedRuns({ directory, history, store }) {
            const record = freshRecord('zeta');
            await store.write(path.join(directory, 'runs/zeta.json'), JSON.stringify(record));
            await store.write(path.join(directory, 'runs/alpha.json'), JSON.stringify({ ...record, id: 'alpha' }));
            await history.compact();
            const listed = await history.list();
            scope.assert.deepEqual(
                listed.map(function (value) {
                    return value.id;
                }),
                [ 'alpha', 'zeta' ]
            );
        });
        return scope.assert.collect();
    }),
    test('list repairs legacy indexes before returning interrupted replay sources', async function (scope: TestScope) {
        await withProject(async function legacyIndex(project) {
            const { directory, history, store } = project;
            const record = { ...freshRecord('interrupted'), status: 'interrupted', result: null };
            await store.write(path.join(directory, 'runs/interrupted.json'), JSON.stringify(record));
            await history.compact();
            const index = await requiredIndex(project);
            await store.write(path.join(directory, 'history/index.json'), JSON.stringify({ ...index, version: 0 }));
            const listed = await history.list();
            scope.assert.equal(listed[0]?.replay, 'available-interrupted');
            const repaired = await requiredIndex(project);
            scope.assert.equal(repaired.version, 1);
        });
        return scope.assert.collect();
    }),
    test('list distinguishes unavailable files and nonreplayable summaries', async function (scope: TestScope) {
        await withProject(async function unavailableRecords(project) {
            const { directory, history, store } = project;
            const recordPath = path.join(directory, 'runs/example.json');
            await store.write(recordPath, JSON.stringify(freshRecord('example')));
            await history.compact();
            const index = await requiredIndex(project);
            await store.write(
                path.join(directory, 'history/index.json'),
                JSON.stringify({
                    ...index,
                    summaries: index.summaries.map(function (value) {
                        return { ...value, replayable: false };
                    })
                })
            );
            await assertUnavailable(scope, history);
            await rm(recordPath);
            await mkdir(recordPath);
            await assertUnavailable(scope, history);
        });
        return scope.assert.collect();
    }),
    test('missing compact history requires repair before listing or pruning', async function (scope: TestScope) {
        await withProject(async function missingIndex({ directory, history }) {
            await rm(path.join(directory, 'history/index.json'));
            await scope.assert.rejects(history.list, { message: /history compact/u });
            await scope.assert.rejects(async function () {
                return history.prune({ dryRun: true });
            }, { message: /history compact/u });
        });
        return scope.assert.collect();
    }),
    test('invalid summary identities cannot escape the runs directory', async function (scope: TestScope) {
        await withProject(async function invalidIdentity(project) {
            const { directory, history, store } = project;
            await store.write(path.join(directory, 'runs/example.json'), JSON.stringify(freshRecord('example')));
            await history.compact();
            const index = await requiredIndex(project);
            for (const id of [ '', '.', '..', '../outside' ]) {
                await store.write(
                    path.join(directory, 'history/index.json'),
                    JSON.stringify({
                        ...index,
                        summaries: index.summaries.map(function (value) {
                            return { ...value, id };
                        })
                    })
                );
                await scope.assert.rejects(history.list, { message: /Invalid history run identity/u });
                await scope.assert.rejects(async function () {
                    return history.prune({ dryRun: false });
                }, { message: /Invalid history run identity/u });
            }
        });
        return scope.assert.collect();
    }),
    test('maintenance recovers dead local owners', async function (scope: TestScope) {
        await withProject(async function deadOwner({ directory, history, store }) {
            const deadPid = 2_147_483_647;
            const ownerPath = path.join(directory, 'active-runs/dead.json');
            await store.write(ownerPath, JSON.stringify({ pid: deadPid, host: os.hostname() }));
            const repaired = await history.compact();
            scope.assert.deepEqual(repaired.diagnostics, [ 'Abandoned run ownership: dead.json' ]);
            scope.assert.equal(await store.read(ownerPath), null);
        });
        return scope.assert.collect();
    }),
    test('maintenance respects a live lease owned on another host', async function (scope: TestScope) {
        await withProject(async function remoteOwner({ directory, history, store }) {
            const release = await store.beginRun('remote');
            try {
                await store.write(
                    path.join(directory, 'active-runs/remote.json'),
                    JSON.stringify({
                        pid: process.pid,
                        host: `${os.hostname()}.remote`
                    })
                );
                await scope.assert.rejects(async function () {
                    return history.clear({ confirmed: true });
                }, { message: /owned by a run on another host/u });
            } finally {
                await release();
            }
        });
        return scope.assert.collect();
    }),
    test('pruning tolerates absent duration state', async function (scope: TestScope) {
        await withProject(async function missingDurations({ directory, history }) {
            await rm(path.join(directory, 'duration-history'), { recursive: true });
            const result = await history.prune({ dryRun: false });
            scope.assert.equal(result.removedWorkEntries, 0);
            scope.assert.deepEqual(result.paths, []);
        });
        return scope.assert.collect();
    }),
    test('malformed ownership directories fail before deleting history', async function (scope: TestScope) {
        await withProject(async function invalidOwners({ directory, history, store }) {
            await store.write(path.join(directory, 'active-runs'), 'invalid');
            await scope.assert.rejects(async function () {
                return history.clear({ confirmed: true });
            }, { message: /History operation failed/u });
            const listed = await history.list();
            scope.assert.equal(listed.length, 0);
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
