import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { historyLockAcquisition, historyLockScenario } from '../test-support/history-lock-acquisition.ts';
import { withinHistoryMaintenanceBudget, historyMaintenanceDiagnostics } from './history-maintenance-budget.ts';

export const testNode = suite('history lock acquisition policy', [
    test('acquires absent locks and forwards compromise notifications', async function (scope: TestScope) {
        const fixture = historyLockAcquisition(historyLockScenario, 100);
        const release = await fixture.acquire();
        const attempt = fixture.attempts[0];
        scope.require.defined(attempt);
        const failure = new Error('lease compromised');
        attempt.onCompromised(failure);
        await release();
        scope.assert.deepEqual(fixture.compromised, [ failure ]);
        scope.assert.partialDeepEqual(attempt, { lockfilePath: '/project/state/history.lock', stale: 50 });
        return scope.assert.collect();
    }),
    test('records stale lock recovery inside a maintenance budget', async function (scope) {
        const fixture = historyLockAcquisition({ ...historyLockScenario, modified: 0 }, 100);
        await withinHistoryMaintenanceBudget(Number.MAX_SAFE_INTEGER, async function () {
            const release = await fixture.acquire();
            scope.assert.deepEqual(historyMaintenanceDiagnostics(), [ 'Stale history lock was recovered.' ]);
            await release();
        }, performance.now.bind(performance));
        return scope.assert.collect();
    }),
    test('does not mark a current lock as stale', async function (scope) {
        const fixture = historyLockAcquisition({ ...historyLockScenario, modified: 975 }, 100);
        await withinHistoryMaintenanceBudget(Number.MAX_SAFE_INTEGER, async function () {
            const release = await fixture.acquire();
            scope.assert.deepEqual(historyMaintenanceDiagnostics(), []);
            await release();
        }, performance.now.bind(performance));
        return scope.assert.collect();
    }),
    test('retries contended locks with bounded waits before acquiring', async function (scope) {
        const fixture = historyLockAcquisition({ ...historyLockScenario, failures: 1, locked: true }, 100);
        const release = await fixture.acquire();
        await release();
        scope.assert.equal(fixture.attempts.length, 2);
        scope.assert.deepEqual(fixture.waits, [ 25 ]);
        return scope.assert.collect();
    }),
    test('preserves acquisition failures when the target is not locked', async function (scope) {
        const failure = new Error('permission denied');
        const fixture = historyLockAcquisition({ ...historyLockScenario, acquisition: failure, failures: 1 }, 100);
        await scope.assert.rejects(fixture.acquire, { exact: failure });
        scope.assert.deepEqual(fixture.waits, []);
        return scope.assert.collect();
    }),
    test('stops retrying at the caller deadline', async function (scope) {
        const failure = new Error('busy');
        const fixture = historyLockAcquisition({
            ...historyLockScenario,
            acquisition: failure,
            failures: 2,
            locked: true
        }, 10);
        await scope.assert.rejects(fixture.acquire, { exact: failure });
        scope.assert.deepEqual(fixture.waits, [ 10 ]);
        scope.assert.equal(fixture.attempts.length, 2);
        return scope.assert.collect();
    }),
    test(
        'defers bounded maintenance after lock contention exhausts its deadline',
        async function (scope) {
            const fixture = historyLockAcquisition({ ...historyLockScenario, failures: 2, locked: true }, 10);
            await scope.assert.rejects(async function () {
                await withinHistoryMaintenanceBudget(
                    Number.MAX_SAFE_INTEGER,
                    fixture.acquire,
                    performance.now.bind(performance)
                );
            }, { name: 'HistoryMaintenanceDeferredError' });
            scope.assert.deepEqual(fixture.waits, [ 10 ]);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'preserves lock acquisition failures',
        cases: [ 'inspection', 'check', 'wait' ] as const,
        caseTitle(phase) {
            return phase;
        },
        async test(scope) {
            const phase = scope.parameters;

            const failure = new Error(`${phase} failed`);
            const fixture = historyLockAcquisition({
                ...historyLockScenario,
                failures: 1,
                locked: phase !== 'inspection',
                [phase]: failure
            }, 100);
            await scope.assert.rejects(fixture.acquire, { exact: failure });
            return scope.assert.collect();
        }
    }),
    test('checks the maintenance deadline before touching the lock', async function (scope) {
        const fixture = historyLockAcquisition(historyLockScenario, 100);
        await scope.assert.rejects(async function () {
            await withinHistoryMaintenanceBudget(0, fixture.acquire, performance.now.bind(performance));
        }, { name: 'HistoryMaintenanceDeferredError' });
        scope.assert.deepEqual(fixture.attempts, []);
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    })
]);
