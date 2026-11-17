import { runIfMain } from '#test-runner';
import { storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    ordinaryBaselineStorage,
    ordinaryStorageScenario,
    ordinaryStorageInput
} from '../test-support/ordinary-baseline-storage.ts';
import { openOrdinaryBaselineStore } from './baseline-store.ts';
import { createBaselineStorage } from './baseline-storage.ts';

export const testNode = suite('ordinary baseline storage policy', [
    test('creates, updates and removes baselines under a publication lock', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        const created = await fixture.store.publish([ { kind: 'create', baseline: storedBaseline } ]);
        const updated = { ...storedBaseline, payload: { kind: 'text' as const, text: '43' } };
        await fixture.store.apply({ kind: 'update', previous: storedBaseline, baseline: updated });
        const entries = await fixture.store.list();
        await fixture.store.apply({ kind: 'remove', baseline: updated });

        scope.assert.deepEqual(
            entries.map(function (entry) {
                return entry.baseline;
            }),
            [ updated ]
        );
        scope.assert.deepEqual({ outcome: created.outcome.kind, events: fixture.events, files: fixture.files.size }, {
            outcome: 'written',
            events: [ 'prepare', 'lock', 'release' ],
            files: 0
        });
        return scope.assert.collect();
    }),
    test('rejects stale create, update and removal plans', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        const file = fixture.storage.location(storedBaseline);
        fixture.seed(file, fixture.storage.encoded(storedBaseline));
        const changed = { ...storedBaseline, payload: { kind: 'text' as const, text: 'changed' } };
        for (
            const change of [ { kind: 'create' as const, baseline: storedBaseline }, {
                kind: 'update' as const,
                previous: changed,
                baseline: storedBaseline
            }, { kind: 'remove' as const, baseline: changed } ]
        ) {
            await scope.assert.rejects(async function () {
                await fixture.store.apply(change);
            }, { message: 'Baseline changed during execution. Run the command again.' });
        }
        scope.assert.equal(fixture.files.size, 1);
        return scope.assert.collect();
    }),
    test('enforces serialized artifact limits before writing', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        const storage = createBaselineStorage(
            { root: '/project', directory: '/project/baselines', maxBytes: 1 },
            fixture.access
        );
        scope.assert.throws(function () {
            return storage.encoded(storedBaseline);
        }, { message: 'Baseline exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    }),
    test('rejects lexical and physical escapes from the project root', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        await scope.assert.rejects(async function () {
            await fixture.storage.checkDirectory('/outside');
        }, { message: 'Baseline directory must remain inside the project root.' });
        await scope.assert.rejects(async function () {
            return await ordinaryBaselineStorage({ ...ordinaryStorageScenario, ancestor: '/outside' });
        }, { message: 'Baseline directory must remain inside the project root.' });
        return scope.assert.collect();
    }),
    test('rejects symbolic link directories', async function (scope: TestScope) {
        await scope.assert.rejects(async function () {
            return await ordinaryBaselineStorage({ ...ordinaryStorageScenario, link: true });
        }, { message: 'Baseline directories cannot be symbolic links.' });
        return scope.assert.collect();
    }),
    test('rejects nonregular and oversized baseline files', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage({ ...ordinaryStorageScenario, file: false });
        const file = fixture.storage.location(storedBaseline);
        fixture.seed(file, '{}');
        await scope.assert.rejects(async function () {
            return await fixture.storage.read(file);
        }, { message: /Invalid baseline file/u });
        const storage = createBaselineStorage({ root: '/project', directory: '/project/baselines', maxBytes: 1 }, {
            ...fixture.access,
            async inspect() {
                return { file: true, link: false, size: ordinaryStorageInput.maxBytes };
            }
        });
        await scope.assert.rejects(async function () {
            return await storage.read(file);
        }, { message: /Invalid baseline file/u });
        return scope.assert.collect();
    }),
    test('distinguishes missing files from files disappearing during reads', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage({ ...ordinaryStorageScenario, missingRead: true });
        const file = fixture.storage.location(storedBaseline);
        scope.assert.equal(await fixture.storage.read(file), null);
        fixture.seed(file, '{}');
        await scope.assert.rejects(async function () {
            return await fixture.storage.read(file);
        }, { message: 'Baseline disappeared while reading.' });
        return scope.assert.collect();
    }),
    test('rejects baselines stored under the wrong identity', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        const file = '/project/baselines/content-snapshot/wrong.baseline.json';
        fixture.seed(file, fixture.storage.encoded(storedBaseline));
        await scope.assert.rejects(async function () {
            return await fixture.storage.read(file);
        }, { message: 'Baseline path does not match its identity.' });
        return scope.assert.collect();
    }),
    test('rejects files disappearing during baseline inventory', async function (scope: TestScope) {
        const fixture = await ordinaryBaselineStorage(ordinaryStorageScenario);
        const access = {
            ...fixture.access,
            async names() {
                return [ 'missing.baseline.json' ];
            }
        };
        const store = await openOrdinaryBaselineStore(ordinaryStorageInput, access);
        await scope.assert.rejects(async function () {
            return await store.list();
        }, { message: 'Baseline disappeared while listing.' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
