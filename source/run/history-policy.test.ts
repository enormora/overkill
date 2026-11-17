import { runIfMain } from '#test-runner';
import { idleHistoryScenario } from '../test-support/history-access.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { historyPolicy } from '../test-support/history-policy.ts';

export const testNode = suite('history operations and replay availability', [
    test('distinguishes complete, interrupted and unavailable replay records', async function (scope: TestScope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'available', 'current');
        const summaries = await fixture.history.list();
        scope.assert.deepEqual(
            summaries.map(function (summary) {
                return { id: summary.id, replay: summary.replay };
            }),
            [ { id: 'interrupted', replay: 'available-interrupted' }, { id: 'passed', replay: 'available' }, {
                id: 'without-replay',
                replay: 'unavailable'
            } ]
        );
        return scope.assert.collect();
    }),
    ...([ 'pruned', 'unavailable' ] as const).map(function (availability) {
        return test(`preserves ${availability} detailed-record availability`, async function (scope: TestScope) {
            const fixture = await historyPolicy(idleHistoryScenario, availability, 'current');
            const summaries = await fixture.history.list();
            scope.assert.true(summaries.every(function (summary) {
                return summary.replay === availability;
            }));
            return scope.assert.collect();
        });
    }),
    test('requires compaction before listing missing history state', async function (scope: TestScope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'missing');
        await scope.assert.rejects(fixture.history.list, {
            message: 'History state is unavailable. Run overkill history compact to repair it.'
        });
        await fixture.history.compact();
        scope.assert.deepEqual(await fixture.history.list(), []);
        return scope.assert.collect();
    }),
    test('repairs legacy compact state automatically before listing', async function (scope: TestScope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'legacy');
        const summaries = await fixture.history.list();
        scope.assert.equal(summaries.length, 3);
        scope.assert.true(summaries.every(function (summary) {
            return summary.replay === 'pruned';
        }));
        return scope.assert.collect();
    }),
    test('compacts retained history under ownership protection', async function (scope: TestScope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'current');
        const result = await fixture.history.compact();
        scope.assert.equal(result.rebuiltRunCount, 0);
        scope.assert.deepEqual(result.diagnostics, []);
        return scope.assert.collect();
    }),
    test('clears only the owned history directories', async function (scope: TestScope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'current');
        const result = await fixture.history.clear({ confirmed: true });
        scope.assert.deepEqual(fixture.removed, [
            '/project/.overkill/runs',
            '/project/.overkill/history',
            '/project/.overkill/duration-history',
            '/project/.overkill/active-runs'
        ]);
        scope.assert.deepEqual(result.paths, fixture.removed);
        return scope.assert.collect();
    }),
    test('does not remove history while a local run owner is alive', async function (scope: TestScope) {
        const fixture = await historyPolicy(
            { ...idleHistoryScenario, owners: [ { name: 'held.json', pid: 42, host: 'test-host' } ], alivePid: 42 },
            'pruned',
            'current'
        );
        await scope.assert.rejects(async function () {
            return await fixture.history.clear({ confirmed: true });
        }, { message: 'History operation failed: Persisted runs are active. Finish them before history maintenance.' });
        scope.assert.deepEqual(fixture.removed, []);
        return scope.assert.collect();
    }),
    ...([ true, false ] as const).map(function (dryRun) {
        return test(`forwards pruning with dryRun=${String(dryRun)}`, async function (scope: TestScope) {
            const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'current');
            const result = await fixture.history.prune({ dryRun });
            scope.assert.deepEqual(fixture.pruned, [ { dryRun } ]);
            scope.assert.equal(result.kind, dryRun ? 'dry-run' : 'applied');
            scope.assert.deepEqual(result.diagnostics, [ 'pruned diagnostic' ]);
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
