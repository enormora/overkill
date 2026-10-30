import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import type { History } from './history-types.ts';
import { createHistory } from './history.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';

async function inProject(operation: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'overkill-history-cli-'));
    try {
        await operation(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
function history(root: string): History {
    return createHistory({
        projectRoot: root,
        config: {
            runtimeStateDir: 'state',
            history: { ...defaultHistoryPolicy, detailedRunLimit: 0 }
        }
    });
}
type HistoryFixture = {
    readonly recordPath: string;
    readonly artifactPath: string;
    readonly recordSource: string;
    readonly startedAt: string;
};
async function prepareArtifacts(root: string): Promise<HistoryFixture> {
    const runs = path.join(root, 'state', 'runs');
    const now = new Date();
    const record = { ...completedHistoryRecord('retained'), startedAt: now.toISOString() };
    await mkdir(path.join(runs, record.id), { recursive: true });
    const recordPath = path.join(runs, `${record.id}.json`);
    const artifactPath = path.join(runs, record.id, 'output.txt');
    await writeFile(recordPath, JSON.stringify(record));
    await writeFile(artifactPath, 'evidence');
    return { recordPath, artifactPath, recordSource: JSON.stringify(record), startedAt: record.startedAt };
}
async function assertPreview(scope: TestScope, root: string, service: History, fixture: HistoryFixture): Promise<void> {
    const before = await readFile(path.join(root, 'state/history/index.json'), 'utf8');
    const summaries = await service.list();
    scope.assert.equal(summaries[0]?.replay, 'available');
    const preview = await service.prune({ dryRun: true });
    scope.assert.deepEqual(preview.paths, [ fixture.recordPath ]);
    scope.assert.equal(await readFile(fixture.recordPath, 'utf8'), fixture.recordSource);
    scope.assert.equal(await readFile(path.join(root, 'state/history/index.json'), 'utf8'), before);
}
async function assertPrunedArtifacts(scope: TestScope, service: History, fixture: HistoryFixture): Promise<void> {
    const applied = await service.prune({ dryRun: false });
    scope.assert.deepEqual(applied.paths, [ fixture.recordPath ]);
    scope.assert.equal(await readFile(fixture.artifactPath, 'utf8'), 'evidence');
    const summaries = await service.list();
    scope.assert.equal(summaries[0]?.replay, 'pruned');
    await service.compact();
    await service.prune({ dryRun: false });
    scope.assert.equal(await readFile(fixture.artifactPath, 'utf8'), 'evidence');
}

function laterTimestamp(timestamp: string, offset: number): string {
    const later = new Date(Date.parse(timestamp) + offset);
    return later.toISOString();
}
type RecordedOutcome = { readonly id: string; readonly startedAt: string; readonly status: 'passed' | 'runner-error'; };
async function recordThenPrune(root: string, service: History, outcome: RecordedOutcome): Promise<void> {
    const record = completedHistoryRecord(outcome.id);
    await writeFile(
        path.join(root, 'state/runs', `${outcome.id}.json`),
        JSON.stringify({
            ...record,
            startedAt: outcome.startedAt,
            result: {
                ...record.result,
                runnerErrors: outcome.status === 'runner-error' ? [ { message: 'runner error' } ] : []
            }
        })
    );
    await service.compact();
    await service.prune({ dryRun: false });
}
export const testNode = suite('history operations', [
    test(
        'explicit maintenance removes abandoned owners while dry-run preserves them',
        async function (scope: TestScope) {
            await inProject(async function abandonedOwner(root) {
                const service = history(root);
                const store = createNodeHistoryStorage(path.join(root, 'state'), defaultHistoryPolicy);
                const ownerPath = path.join(root, 'state/active-runs/abandoned.json');
                const content = JSON.stringify({ pid: 1, host: `${os.hostname()}.departed` });
                await service.compact();
                await store.write(ownerPath, content);
                await service.prune({ dryRun: true });
                scope.assert.equal(await store.read(ownerPath), content);
                await service.compact();
                scope.assert.equal(await store.read(ownerPath), null);
            });
            return scope.assert.collect();
        }
    ),

    test(
        'successful runs without artifacts retain their place after summaries expire',
        async function (scope: TestScope) {
            await inProject(async function successfulWindow(root) {
                const fixture = await prepareArtifacts(root);
                const service = createHistory({
                    projectRoot: root,
                    config: {
                        runtimeStateDir: 'state',
                        history: {
                            ...defaultHistoryPolicy,
                            detailedRunLimit: 0,
                            runSummaryLimit: 1,
                            successfulArtifactRunLimit: 2
                        }
                    }
                });
                await service.compact();
                await service.prune({ dryRun: false });
                await recordThenPrune(root, service, {
                    id: 'empty',
                    startedAt: laterTimestamp(fixture.startedAt, 1000),
                    status: 'passed'
                });
                await recordThenPrune(root, service, {
                    id: 'error',
                    startedAt: laterTimestamp(fixture.startedAt, 2000),
                    status: 'runner-error'
                });
                await recordThenPrune(root, service, {
                    id: 'new-empty',
                    startedAt: laterTimestamp(fixture.startedAt, 3000),
                    status: 'passed'
                });
                await scope.assert.rejects(async function () {
                    return readFile(fixture.artifactPath);
                }, { code: 'ENOENT' });
            });
            return scope.assert.collect();
        }
    ),

    test(
        'dry-run preserves records and applied pruning preserves artifact metadata',
        async function (scope: TestScope) {
            await inProject(async function pruneProject(root) {
                const fixture = await prepareArtifacts(root);
                const service = history(root);
                await service.compact();
                await assertPreview(scope, root, service, fixture);
                await assertPrunedArtifacts(scope, service, fixture);
            });
            return scope.assert.collect();
        }
    ),
    test(
        'prune preserves records when their artifact manifest uses an unsupported version',
        async function (scope: TestScope) {
            await inProject(async function futureMetadata(root) {
                const fixture = await prepareArtifacts(root);
                await writeFile(path.join(root, 'state/runs/retained/retention.json'), JSON.stringify({ version: 99 }));
                const service = history(root);
                await service.compact();
                await scope.assert.rejects(async function () {
                    return service.prune({ dryRun: false });
                }, {
                    message: /History operation failed/
                });
                scope.assert.equal(await readFile(fixture.recordPath, 'utf8'), fixture.recordSource);
            });
            return scope.assert.collect();
        }
    ),
    test('clear preserves witnesses, corpus and unrelated files', async function (scope: TestScope) {
        await inProject(async function clearProject(root) {
            const service = history(root);
            await service.compact();
            for (const name of [ 'witnesses', 'corpus', 'custom' ]) {
                await mkdir(path.join(root, 'state', name), { recursive: true });
                await writeFile(path.join(root, 'state', name, 'keep'), name);
            }
            await service.clear({ confirmed: true });
            await service.clear({ confirmed: true });
            for (const name of [ 'witnesses', 'corpus', 'custom' ]) {
                scope.assert.equal(await readFile(path.join(root, 'state', name, 'keep'), 'utf8'), name);
            }
        });
        return scope.assert.collect();
    }),
    test('active persisted owners block prune, compact and clear until released', async function (scope: TestScope) {
        await inProject(async function activeProject(root) {
            const service = history(root);
            await service.compact();
            const store = createNodeHistoryStorage(path.join(root, 'state'), defaultHistoryPolicy);
            const release = await store.beginRun('active');
            try {
                await scope.assert.rejects(async function () {
                    return service.clear({ confirmed: true });
                }, {
                    message: /History operation failed/
                });
                await scope.assert.rejects(async function () {
                    return service.prune({ dryRun: false });
                }, {
                    message: /History operation failed/
                });
                await scope.assert.rejects(async function () {
                    return service.compact();
                }, { message: /History operation failed/ });
            } finally {
                await release();
            }
            await service.clear({ confirmed: true });
        });
        return scope.assert.collect();
    }),
    test('prune rejects unknown artifact metadata without deleting evidence', async function (scope: TestScope) {
        await inProject(async function malformedProject(root) {
            const service = history(root);
            await service.compact();
            const directory = path.join(root, 'state/runs/unknown');
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, 'evidence'), 'keep');
            await scope.assert.rejects(async function () {
                return service.prune({ dryRun: false });
            }, { message: /History operation failed/ });
            scope.assert.equal(await readFile(path.join(directory, 'evidence'), 'utf8'), 'keep');
        });
        return scope.assert.collect();
    }),
    test('clear refuses state directories that contain the project', async function (scope: TestScope) {
        await inProject(async function ancestorState(root) {
            const projectRoot = path.join(root, 'project');
            await mkdir(projectRoot);
            await mkdir(path.join(root, 'runs'));
            await writeFile(path.join(root, 'runs/keep'), 'evidence');
            const service = createHistory({
                projectRoot,
                config: { history: defaultHistoryPolicy, runtimeStateDir: '..' }
            });
            await scope.assert.rejects(async function () {
                return service.clear({ confirmed: true });
            }, {
                message: /History operation failed/
            });
            scope.assert.equal(await readFile(path.join(root, 'runs/keep'), 'utf8'), 'evidence');
        });
        return scope.assert.collect();
    }),
    test('clear refuses a linked history directory', async function (scope: TestScope) {
        await inProject(async function linkedProject(root) {
            const service = history(root);
            await service.compact();
            const external = path.join(root, 'external');
            await mkdir(external);
            await writeFile(path.join(external, 'keep'), 'evidence');
            await symlink(external, path.join(root, 'state/runs'));
            await scope.assert.rejects(async function () {
                return service.clear({ confirmed: true });
            }, {
                message: /History operation failed/
            });
            scope.assert.equal(await readFile(path.join(external, 'keep'), 'utf8'), 'evidence');
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
