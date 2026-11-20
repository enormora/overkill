import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { historyRetention, historyRetentionScenario } from '../test-support/history-retention.ts';
import { applyHistoryRetention } from './history-pruning.ts';
import { readCompactHistory } from './history-storage.ts';

export const testNode = authoredSuite('history retention publication', [
    test('previews record and artifact removals without changing storage', async function (scope: TestScope) {
        const fixture = await historyRetention(historyRetentionScenario);
        const result = await applyHistoryRetention(fixture.context, { dryRun: true }, fixture.runtime);
        scope.assert.deepEqual<unknown, unknown>(result, {
            compactedRecords: 1,
            kind: 'dry-run',
            diagnostics: [],
            paths: [
                '/project/state/runs/old.json',
                '/project/state/runs/new',
                '/project/state/runs/old'
            ],
            removedSummaries: 1,
            removedCases: 0,
            removedWorkEntries: 0
        });
        scope.assert.deepEqual<unknown, unknown>(fixture.removed, []);
        scope.assert.deepEqual<unknown, unknown>(fixture.written, []);
        return scope.assert.collect();
    }),
    test('commits retained summaries after removing expired records and artifacts', async function (scope: TestScope) {
        const fixture = await historyRetention(historyRetentionScenario);
        const result = await applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
        const index = await readCompactHistory(fixture.context.store, fixture.context.directory);
        scope.assert.equal(result.kind, 'applied');
        scope.assert.deepEqual<unknown, unknown>(fixture.removed, result.paths);
        scope.assert.deepEqual<unknown, unknown>(
            index?.summaries.map(function (summary) {
                return { id: summary.id, replayable: summary.replayable };
            }),
            [ { id: 'new', replayable: false } ]
        );
        scope.assert.deepEqual<unknown, unknown>(fixture.written, [
            '/project/state/runs/new.json',
            '/project/state/history/index.json'
        ]);
        return scope.assert.collect();
    }),
    test(
        'refreshes metadata for retained artifacts and preserves replayable summaries',
        async function (scope: TestScope) {
            const fixture = await historyRetention({ ...historyRetentionScenario, keepRecords: true });
            const result = await applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
            const index = await readCompactHistory(fixture.context.store, fixture.context.directory);
            scope.assert.deepEqual<unknown, unknown>(result.paths, [
                '/project/state/runs/old.json',
                '/project/state/runs/old'
            ]);
            scope.assert.equal(index?.summaries[0]?.replayable, true);
            scope.assert.deepEqual<unknown, unknown>(fixture.written, [
                '/project/state/runs/new/retention.json',
                '/project/state/history/index.json'
            ]);
            scope.assert.equal(
                await fixture.context.store.read('/project/state/runs/new/retention.json'),
                JSON.stringify({
                    version: 1,
                    detail: 'detailed',
                    id: 'new',
                    startedAt: '2026-10-29T00:00:00.000Z',
                    status: 'passed'
                })
            );
            return scope.assert.collect();
        }
    ),
    test('requires a compact history index before deleting records', async function (scope: TestScope) {
        const fixture = await historyRetention({ ...historyRetentionScenario, missingIndex: true });
        await scope.assert.rejects(async function () {
            return applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
        }, {
            message: 'History state is unavailable. Run overkill history compact to repair it.'
        });
        scope.assert.deepEqual<unknown, unknown>(fixture.removed, []);
        scope.assert.deepEqual<unknown, unknown>(fixture.written, []);
        return scope.assert.collect();
    }),
    test('expires summaries and case observations past their retention windows', async function (scope: TestScope) {
        const fixture = await historyRetention({ ...historyRetentionScenario, expired: true });
        const result = await applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
        const index = await readCompactHistory(fixture.context.store, fixture.context.directory);
        scope.assert.deepEqual<unknown, unknown>({ summaries: result.removedSummaries, cases: result.removedCases }, {
            summaries: 2,
            cases: 1
        });
        scope.assert.deepEqual<unknown, unknown>(index?.summaries, []);
        scope.assert.deepEqual<unknown, unknown>(index?.cases, []);
        return scope.assert.collect();
    }),
    test('preserves the compact index when a filesystem removal fails', async function (scope: TestScope) {
        const failure = new Error('Cannot remove history.');
        const fixture = await historyRetention({ ...historyRetentionScenario, removalFailure: failure });
        await scope.assert.rejects(async function () {
            return applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
        }, {
            exact: failure
        });
        scope.assert.equal(await fixture.context.store.read('/project/state/history/index.json'), fixture.initial);
        scope.assert.deepEqual<unknown, unknown>(fixture.written, [ '/project/state/runs/new.json' ]);
        return scope.assert.collect();
    }),
    test('publishes duration retention and summaries in a single history index', async function (scope: TestScope) {
        const fixture = await historyRetention(historyRetentionScenario);
        await applyHistoryRetention(fixture.context, { dryRun: false }, fixture.runtime);
        const index = await readCompactHistory(fixture.context.store, fixture.context.directory);
        scope.assert.equal(index?.version, 1);
        scope.assert.equal(index?.durations.entries[0]?.count, 2);
        scope.assert.equal(index?.durations.entries[0]?.observations.length, 2);
        scope.assert.deepEqual<unknown, unknown>(fixture.written, [
            '/project/state/runs/new.json',
            '/project/state/history/index.json'
        ]);
        return scope.assert.collect();
    })
]);
