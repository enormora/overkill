import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { memoryHistoryAccess, idleHistoryScenario } from '../test-support/history-access.ts';

import { RunCollectionError } from './run-errors.ts';
import { HistoryMaintenanceDeferredError, withinHistoryMaintenanceBudget } from './history-maintenance-budget.ts';
import { inspectDetailedRecordState, assertHistoryRunId, compareHistoryRuns } from './history-state-access.ts';

export const testNode: TestNode = suite('history access ownership policy', [
    test(
        'uses the configured state directory and acquires an idle owner guard',
        async function (scope) {
            const fixture = await memoryHistoryAccess(idleHistoryScenario);
            await fixture.access.assertOwnedLocation();
            await fixture.access.assertIdle();
            scope.assert.equal(
                await fixture.access.guarded(async function () {
                    return 42;
                }),
                42
            );
            scope.assert.deepEqual(fixture.created, [ '/project/.overkill' ]);
            scope.assert.deepEqual(fixture.access.diagnostics(), []);
            return scope.assert.collect();
        }
    ),
    test('removes only abandoned ownership metadata and its lease', async function (scope) {
        const fixture = await memoryHistoryAccess({
            ...idleHistoryScenario,
            owners: [ { name: 'old.json', pid: 42, host: 'test-host' }, {
                name: 'unrelated.txt',
                pid: 43,
                host: 'test-host'
            } ]
        });
        await fixture.access.assertIdle();
        scope.assert.deepEqual(fixture.access.diagnostics(), [ 'Abandoned run ownership: old.json' ]);
        await fixture.access.removeAbandonedOwners();
        scope.assert.deepEqual(fixture.removed, [ {
            target: '/project/.overkill/active-runs/old.json.lease',
            recursive: true
        }, { target: '/project/.overkill/active-runs/old.json', recursive: false } ]);
        await fixture.access.assertIdle();
        scope.assert.deepEqual(fixture.access.diagnostics(), []);
        return scope.assert.collect();
    }),
    test('rejects maintenance while a local run owner is alive', async function (scope) {
        const fixture = await memoryHistoryAccess({
            ...idleHistoryScenario,
            alivePid: 42,
            owners: [ { name: 'live.json', pid: 42, host: 'test-host' } ]
        });
        await scope.assert.rejects(async function () {
            await fixture.access.assertIdle();
        }, { message: 'Persisted runs are active. Finish them before history maintenance.' });
        scope.assert.deepEqual(fixture.removed, []);
        return scope.assert.collect();
    }),
    test(
        'defers bounded maintenance instead of reclassifying active ownership',
        async function (scope) {
            const fixture = await memoryHistoryAccess({
                ...idleHistoryScenario,
                alivePid: 42,
                owners: [ { name: 'live.json', pid: 42, host: 'test-host' } ]
            });
            await withinHistoryMaintenanceBudget(60_000, async function () {
                await scope.assert.rejects(async function () {
                    await fixture.access.guarded(fixture.access.assertIdle);
                }, { type: HistoryMaintenanceDeferredError });
            }, performance.now.bind(performance));
            return scope.assert.collect();
        }
    ),
    test('checks remote ownership leases before reclaiming metadata', async function (scope) {
        const active = await memoryHistoryAccess({
            ...idleHistoryScenario,
            foreignLeaseActive: true,
            owners: [ { name: 'remote.json', pid: 42, host: 'remote-host' } ]
        });
        await scope.assert.rejects(async function () {
            await active.access.assertIdle();
        }, { message: 'History is owned by a run on another host.' });
        const abandoned = await memoryHistoryAccess({
            ...idleHistoryScenario,
            owners: [ { name: 'remote.json', pid: 42, host: 'remote-host' } ]
        });
        await abandoned.access.assertIdle();
        scope.assert.deepEqual(abandoned.access.diagnostics(), [ 'Abandoned run ownership: remote.json' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects unsafe history state locations',
        cases: [ '.', '/' ],
        caseTitle(stateDirectory) {
            return `${stateDirectory}`;
        },
        async test(scope) {
            const stateDirectory = scope.parameters;

            const fixture = await memoryHistoryAccess({ ...idleHistoryScenario, stateDirectory });
            await scope.assert.rejects(async function () {
                await fixture.access.assertOwnedLocation();
            }, { message: 'History state must have its own directory.' });
            return scope.assert.collect();
        }
    }),
    test(
        'rejects linked state subdirectories before touching their contents',
        async function (scope) {
            const fixture = await memoryHistoryAccess({ ...idleHistoryScenario, linked: '/project/.overkill/runs' });
            await scope.assert.rejects(async function () {
                await fixture.access.assertOwnedLocation();
            }, { message: 'History directory is a symbolic link: /project/.overkill/runs' });
            scope.assert.deepEqual(fixture.removed, []);
            return scope.assert.collect();
        }
    ),
    test(
        'wraps storage failures while preserving classified history failures',
        async function (scope) {
            const fixture = await memoryHistoryAccess(idleHistoryScenario);
            const cause = new Error('Storage failed.');
            await scope.assert.rejects(async function () {
                await fixture.access.guarded(async function () {
                    throw cause;
                });
            }, {
                type: RunCollectionError,
                message: 'History operation failed: Storage failed.',
                cause: { exact: cause }
            });
            const classified = new RunCollectionError('Already classified.', {}, 'runtime-state');
            await scope.assert.rejects(async function () {
                await fixture.access.guarded(async function () {
                    throw classified;
                });
            }, { exact: classified });
            return scope.assert.collect();
        }
    ),
    test(
        'distinguishes pruned records from directories and incompatible content',
        async function (scope) {
            const fixture = await memoryHistoryAccess(idleHistoryScenario);
            scope.assert.equal(
                await inspectDetailedRecordState('/record.json', {
                    ...fixture.runtime,
                    async metadata() {
                        return null;
                    }
                }),
                'pruned'
            );
            scope.assert.equal(
                await inspectDetailedRecordState('/record.json', {
                    ...fixture.runtime,
                    async metadata() {
                        return 'other';
                    }
                }),
                'unavailable'
            );
            scope.assert.equal(
                await inspectDetailedRecordState('/record.json', {
                    ...fixture.runtime,
                    async readText() {
                        return 'invalid JSON';
                    }
                }),
                'unavailable'
            );
            scope.assert.equal(await inspectDetailedRecordState('/record.json', fixture.runtime), 'unavailable');
            return scope.assert.collect();
        }
    ),
    test(
        'rejects path traversal in run identities and orders equal timestamps by identity',
        function (scope) {
            for (const id of [ '', '..', '.', '../run', '/run' ]) {
                scope.assert.throws(function () {
                    assertHistoryRunId(id);
                }, { message: 'Invalid history run identity.' });
            }
            assertHistoryRunId('valid-run');
            scope.assert.lessThan(
                compareHistoryRuns({ id: 'a', startedAt: '2026-01-02' }, { id: 'b', startedAt: '2026-01-01' }),
                0
            );
            scope.assert.lessThan(
                compareHistoryRuns({ id: 'a', startedAt: '2026-01-01' }, { id: 'b', startedAt: '2026-01-01' }),
                0
            );
            return scope.assert.collect();
        }
    )
]);
