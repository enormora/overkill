import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { historyStorage, historyStorageScenario } from '../test-support/history-storage.ts';

export const testNode = suite('history storage ownership', [
    test(
        'reads and writes records and lists JSON files within the selected directory',
        async function (scope: TestScope) {
            const fixture = historyStorage(historyStorageScenario);
            await fixture.store.write('/project/state/runs/one.json', 'one');
            await fixture.store.write('/project/state/runs/notes.txt', 'ignored');
            await fixture.store.write('/project/state/elsewhere/two.json', 'other');
            scope.assert.equal(await fixture.store.read('/project/state/runs/one.json'), 'one');
            scope.assert.equal(await fixture.store.read('/project/state/missing'), null);
            scope.assert.deepEqual(await fixture.store.list('/project/state/runs'), [ '/project/state/runs/one.json' ]);
            return scope.assert.collect();
        }
    ),
    test('releases its lock after returning the operation result', async function (scope: TestScope) {
        const fixture = historyStorage(historyStorageScenario);
        scope.assert.equal(
            await fixture.store.withLock(async function () {
                return 42;
            }),
            42
        );
        scope.assert.deepEqual(fixture.events, [ 'prepare:/project/state', 'lock', 'release-lock' ]);
        return scope.assert.collect();
    }),
    test('releases locks when operations fail', async function (scope: TestScope) {
        const fixture = historyStorage(historyStorageScenario);
        const failure = new Error('Operation failed.');
        await scope.assert.rejects(async function () {
            return fixture.store.withLock(async function () {
                throw failure;
            });
        }, { exact: failure });
        scope.assert.deepEqual(fixture.events, [ 'prepare:/project/state', 'lock', 'release-lock' ]);
        return scope.assert.collect();
    }),
    test('surfaces compromised locks even when the operation succeeds', async function (scope: TestScope) {
        const failure = new Error('Lock compromised.');
        const fixture = historyStorage({ ...historyStorageScenario, lockCompromised: failure });
        await scope.assert.rejects(async function () {
            return fixture.store.withLock(async function () {
                return 42;
            });
        }, { exact: failure });
        scope.assert.equal(fixture.events.at(-1), 'release-lock');
        return scope.assert.collect();
    }),
    test('does not execute operations when lock acquisition fails', async function (scope: TestScope) {
        const failure = new Error('Cannot lock.');
        const fixture = historyStorage({ ...historyStorageScenario, lockFailure: failure });
        let executed = false;
        await scope.assert.rejects(async function () {
            return fixture.store.withLock(async function () {
                executed = true;
            });
        }, { exact: failure });
        scope.assert.false(executed);
        return scope.assert.collect();
    }),
    test(
        'registers an owner under the history lock and releases its lease before removal',
        async function (scope: TestScope) {
            const fixture = historyStorage(historyStorageScenario);
            const release = await fixture.store.beginRun('unit-run');
            const ownerPath = '/project/state/active-runs/unit-run.json';
            scope.assert.equal(await fixture.store.read(ownerPath), JSON.stringify({ pid: 42, host: 'unit-host' }));
            await release();
            scope.assert.equal(await fixture.store.read(ownerPath), null);
            scope.assert.deepEqual(fixture.events, [
                'prepare:/project/state',
                'lock',
                'lease',
                'release-lock',
                'release-lease',
                `remove:${ownerPath}`
            ]);
            return scope.assert.collect();
        }
    ),
    test('removes a newly created owner when lease acquisition fails', async function (scope: TestScope) {
        const failure = new Error('Cannot lease.');
        const fixture = historyStorage({ ...historyStorageScenario, leaseFailure: failure });
        await scope.assert.rejects(async function () {
            return fixture.store.beginRun('unit-run');
        }, { exact: failure });
        scope.assert.equal(await fixture.store.read('/project/state/active-runs/unit-run.json'), null);
        scope.assert.deepEqual(fixture.events.slice(-2), [
            'remove:/project/state/active-runs/unit-run.json',
            'release-lock'
        ]);
        return scope.assert.collect();
    }),
    test('reports a compromised run lease after releasing its owner', async function (scope: TestScope) {
        const failure = new Error('Lease compromised.');
        const fixture = historyStorage({ ...historyStorageScenario, leaseCompromised: failure });
        const release = await fixture.store.beginRun('unit-run');
        await scope.assert.rejects(release, { exact: failure });
        scope.assert.equal(await fixture.store.read('/project/state/active-runs/unit-run.json'), null);
        return scope.assert.collect();
    })
]);
