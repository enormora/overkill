import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { createPerformanceBaselineStore, performanceBaselineKey } from './performance-store.ts';
import { performanceBaselineIdentity, type StoredPerformanceBaseline } from './performance-baseline.ts';

const baseline: StoredPerformanceBaseline = {
    adapter: 'duration',
    expected: {
        calibration: { context: {}, kind: 'comparable', machineClass: 'test-host', metadata: {} },
        value: { maximum: 100 }
    },
    profile: 'startup',
    subtype: 'performance-baseline',
    version: 1,
    work: createDefaultWorkId(createCaseId('startup.bench.ts', [], 'starts', null))
};

type StoreFixture = {
    readonly directory: string;
    readonly store: Awaited<ReturnType<typeof createPerformanceBaselineStore>>;
};

async function withStore<Value>(
    run: (input: StoreFixture) => Promise<Value>
): Promise<Value> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-baselines-'));
    try {
        return await run({
            directory,
            store: await createPerformanceBaselineStore({
                directory: 'baselines',
                maxBytes: 4096,
                projectRoot: directory
            })
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function assertRemoval(
    scope: TestScope,
    fixture: StoreFixture,
    other: StoredPerformanceBaseline,
    updated: StoredPerformanceBaseline
): Promise<void> {
    const { directory, store } = fixture;
    await store.apply({ baseline: updated, kind: 'remove' });
    const remaining = await store.list();
    scope.assert.deepEqual(
        remaining.map(function storedValue(entry) {
            return entry.baseline;
        }),
        [ other ]
    );
    const names = await readdir(path.join(directory, 'baselines', 'performance'));
    scope.assert.equal(names.length, 1);
}

async function assertPersistedBaseline(
    scope: TestScope,
    filePath: string,
    expected: StoredPerformanceBaseline
): Promise<void> {
    const content = await readFile(filePath, 'utf8');
    const persisted: unknown = JSON.parse(content);
    scope.assert.deepEqual(persisted, expected);
}

export const testNode = suite('performance baseline storage', [
    test('lists an absent store without creating files', async function (scope: TestScope) {
        await withStore(async function inspectAbsentStore({ directory, store }) {
            scope.assert.deepEqual(await store.list(), []);
            scope.assert.deepEqual(await readdir(directory), []);
        });
        return scope.assert.collect();
    }),
    test(
        'creates, replaces, and removes an identity without touching another machine class',
        async function (scope: TestScope) {
            await withStore(async function reconcileStore({ directory, store }) {
                const other = {
                    ...baseline,
                    expected: {
                        ...baseline.expected,
                        calibration: { ...baseline.expected.calibration, machineClass: 'another-host' }
                    }
                };
                const updated = { ...baseline, expected: { ...baseline.expected, value: { maximum: 200 } } };
                await store.apply({ baseline, kind: 'create' });
                await store.apply({ baseline: other, kind: 'create' });
                scope.assert.notEqual(
                    performanceBaselineKey(performanceBaselineIdentity(baseline)),
                    performanceBaselineKey(performanceBaselineIdentity(other))
                );
                await store.apply({ baseline: updated, kind: 'update', previous: baseline });
                const replaced = await store.list();
                scope.assert.deepEqual(
                    replaced
                        .map(function expectedValue(entry) {
                            return entry.baseline.expected.value;
                        })
                        .toSorted(function byMaximum(left, right) {
                            return JSON.stringify(left).localeCompare(JSON.stringify(right));
                        }),
                    [ { maximum: 100 }, { maximum: 200 } ]
                );
                await assertRemoval(scope, { directory, store }, other, updated);
            });
            return scope.assert.collect();
        }
    ),
    test(
        'refuses exclusive creation and preserves an externally changed expectation',
        async function (scope: TestScope) {
            await withStore(async function preserveEditedStore({ directory, store }) {
                await store.apply({ baseline, kind: 'create' });
                await scope.assert.rejects(async function duplicateCreate() {
                    await store.apply({ baseline, kind: 'create' });
                }, { message: 'Performance baseline changed during execution. Run the command again.' });
                const [ entry ] = await store.list();
                scope.require.defined(entry);
                const filePath = path.join(directory, entry.path);
                const edited = { ...baseline, expected: { ...baseline.expected, value: { maximum: 500 } } };
                await writeFile(filePath, JSON.stringify(edited));
                await scope.assert.rejects(async function replaceEditedBaseline() {
                    await store.apply({ baseline, kind: 'update', previous: baseline });
                }, { message: 'Performance baseline changed during execution. Run the command again.' });
                await assertPersistedBaseline(scope, filePath, edited);
            });
            return scope.assert.collect();
        }
    ),
    test('rejects malformed and unsupported envelopes without rewriting them', async function (scope: TestScope) {
        await withStore(async function rejectInvalidStore({ directory, store }) {
            await store.apply({ baseline, kind: 'create' });
            const [ entry ] = await store.list();
            scope.require.defined(entry);
            const filePath = path.join(directory, entry.path);
            for (const content of [ '{', JSON.stringify({ ...baseline, version: 2 }) ]) {
                await writeFile(filePath, content);
                await scope.assert.rejects(async function listInvalidBaseline() {
                    await store.list();
                }, { message: /.+/ });
                scope.assert.equal(await readFile(filePath, 'utf8'), content);
            }
        });
        return scope.assert.collect();
    })
]);
