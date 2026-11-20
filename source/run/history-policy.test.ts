import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { idleHistoryScenario } from '../test-support/history-access.ts';

import { historyPolicy } from '../test-support/history-policy.ts';

export const testNode: TestNode = suite('history operations and replay availability', [
    test(
        'distinguishes complete, interrupted and unavailable replay records',
        async function (scope) {
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
        }
    ),
    table({
        title: 'preserves detailed-record availability',
        cases: [ 'pruned', 'unavailable' ] as const,
        caseTitle(availability) {
            return availability;
        },
        async test(scope) {
            const availability = scope.parameters;

            const fixture = await historyPolicy(idleHistoryScenario, availability, 'current');
            const summaries = await fixture.history.list();
            scope.assert.true(summaries.every(function (summary) {
                return summary.replay === availability;
            }));
            return scope.assert.collect();
        }
    }),
    test('requires compaction before listing missing history state', async function (scope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'missing');
        await scope.assert.rejects(fixture.history.list, {
            message: 'History state is unavailable. Run overkill history compact to repair it.'
        });
        await fixture.history.compact();
        scope.assert.deepEqual(await fixture.history.list(), []);
        return scope.assert.collect();
    }),
    test('requires explicit repair for unsupported history indexes', async function (scope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'legacy');
        await scope.assert.rejects(fixture.history.list, { message: /overkill history compact/ });
        await fixture.history.compact();
        scope.assert.deepEqual(await fixture.history.list(), []);
        return scope.assert.collect();
    }),
    test('compacts retained history under ownership protection', async function (scope) {
        const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'current');
        const result = await fixture.history.compact();
        scope.assert.equal(result.rebuiltRunCount, 0);
        scope.assert.deepEqual(result.diagnostics, []);
        return scope.assert.collect();
    }),
    test('clears only the owned history directories', async function (scope) {
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
    test('does not remove history while a local run owner is alive', async function (scope) {
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
    table({
        title: 'forwards pruning previews and publication',
        cases: [ true, false ] as const,
        caseTitle: String,
        async test(scope) {
            const dryRun = scope.parameters;

            const fixture = await historyPolicy(idleHistoryScenario, 'pruned', 'current');
            const result = await fixture.history.prune({ dryRun });
            scope.assert.deepEqual(fixture.pruned, [ { dryRun } ]);
            scope.assert.equal(result.kind, dryRun ? 'dry-run' : 'applied');
            scope.assert.deepEqual(result.diagnostics, [ 'pruned diagnostic' ]);
            return scope.assert.collect();
        }
    })
]);
