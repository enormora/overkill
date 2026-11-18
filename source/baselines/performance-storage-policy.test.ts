import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    performanceStorage,
    performanceStorageScenario,
    storedPerformanceFixture as baseline
} from '../test-support/performance-storage.ts';
import type { StoredPerformanceBaseline } from './performance-baseline.ts';
import { openPerformanceBaselineStore, type PerformanceBaselineStore } from './performance-store.ts';

async function storedValues(store: PerformanceBaselineStore): Promise<readonly StoredPerformanceBaseline[]> {
    const entries = await store.list();
    return entries.map(function baselineValue(entry) {
        return entry.baseline;
    });
}
export const testNode = suite('performance storage policy', [
    test('lists an absent store without preparing storage', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        scope.assert.deepEqual(await fixture.store.list(), []);
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('creates updates and removes a stable identity', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        await fixture.store.apply({ kind: 'create', baseline });
        scope.assert.deepEqual(
            await storedValues(fixture.store),
            [ baseline ]
        );
        const updated = { ...baseline, expected: { ...baseline.expected, value: { maximum: 200 } } };
        await fixture.store.apply({ kind: 'update', baseline: updated, previous: baseline });
        scope.assert.deepEqual(
            await storedValues(fixture.store),
            [ updated ]
        );
        await fixture.store.apply({ kind: 'remove', baseline: updated });
        scope.assert.deepEqual(await fixture.store.list(), []);
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'create', 'prepare', 'update', 'remove' ]);
        return scope.assert.collect();
    }),
    test('rejects lexical and physical directory escapes', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        const message = 'Performance baseline directory must remain inside the project root.';
        await scope.assert.rejects(
            async function () {
                return openPerformanceBaselineStore(
                    { projectRoot: '/project', directory: '../outside', maxBytes: 1024 },
                    fixture.access
                );
            },
            { message }
        );
        await scope.assert.rejects(async function () {
            return performanceStorage({ ...performanceStorageScenario, ancestor: '/outside' });
        }, {
            message
        });
        return scope.assert.collect();
    }),
    test('does not overwrite a concurrently created baseline', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        await fixture.store.apply({ kind: 'create', baseline });
        await scope.assert.rejects(async function () {
            return fixture.store.apply({ kind: 'create', baseline });
        }, {
            message: 'Performance baseline changed during execution. Run the command again.'
        });
        scope.assert.deepEqual(
            await storedValues(fixture.store),
            [ baseline ]
        );
        return scope.assert.collect();
    }),
    test('requires the expected previous baseline before changing or removing it', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        await scope.assert.rejects(async function () {
            return fixture.store.apply({ kind: 'remove', baseline });
        }, {
            message: 'Performance baseline disappeared during execution.'
        });
        await fixture.store.apply({ kind: 'create', baseline });
        const changed = { ...baseline, expected: { ...baseline.expected, value: { maximum: 300 } } };
        await scope.assert.rejects(async function () {
            return fixture.store.apply({ kind: 'remove', baseline: changed });
        }, {
            message: 'Performance baseline changed during execution. Run the command again.'
        });
        return scope.assert.collect();
    }),
    test('bounds encoded baseline content before preparing files', async function (scope: TestScope) {
        const fixture = await performanceStorage({ ...performanceStorageScenario, maxBytes: 1 });
        await scope.assert.rejects(async function () {
            return fixture.store.apply({ kind: 'create', baseline });
        }, {
            message: 'Performance baseline exceeds the configured artifact byte limit.'
        });
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('rejects nonregular files and bounds reads before parsing', async function (scope: TestScope) {
        const fixture = await performanceStorage({ ...performanceStorageScenario, regular: false });
        fixture.seed('baselines/performance/invalid.benchmark.json', '{}');
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Invalid performance baseline file: invalid.benchmark.json'
        });
        const bounded = await performanceStorage({ ...performanceStorageScenario, maxBytes: 1 });
        bounded.seed('baselines/performance/large.benchmark.json', '{}');
        await scope.assert.rejects(async function () {
            return bounded.store.list();
        }, {
            message: 'Invalid performance baseline file: large.benchmark.json'
        });
        return scope.assert.collect();
    }),
    test('detects files disappearing between metadata and content reads', async function (scope: TestScope) {
        const fixture = await performanceStorage({ ...performanceStorageScenario, disappeared: true });
        fixture.seed('baselines/performance/missing.benchmark.json', '{}');
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Performance baseline disappeared while reading: missing.benchmark.json'
        });
        return scope.assert.collect();
    }),
    test('ignores unrelated files and rejects identity mismatches', async function (scope: TestScope) {
        const fixture = await performanceStorage(performanceStorageScenario);
        fixture.seed('baselines/performance/notes.txt', 'ignored');
        scope.assert.deepEqual(await fixture.store.list(), []);
        fixture.seed('baselines/performance/wrong.benchmark.json', JSON.stringify(baseline));
        await scope.assert.rejects(async function () {
            return fixture.store.list();
        }, {
            message: 'Performance baseline path does not match its identity: wrong.benchmark.json'
        });
        return scope.assert.collect();
    })
]);
