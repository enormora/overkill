import { runIfMain } from '#test-runner';
import { createDeterministicClock } from '@enormora/clock';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { completedHistoryRecord, historyTimestamp, historyWork } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import { resolveLastFailedSelection } from './run-selection.ts';
import { updateCompactHistory } from './history-storage.ts';
import { readLastFailedSelection } from './last-failed-selection.ts';
import { copyRunSelection, invalidRunSelectionMessage } from './run-selection-filters.ts';

export const testNode = suite('last-failed selection', [
    ...([ 'pass', 'skip', 'inconclusive', 'fail', 'crashed', 'process-exhausted', 'runtime-policy' ] as const).map(
        function latestVerdict(verdict) {
            return test(`latest ${verdict} determines selection`, async function (scope: TestScope) {
                const store = createMemoryHistoryStorage();
                const config = normalizeConfig({});
                const directory = '/project/.overkill';
                const context = {
                    directory,
                    policy: config.history,
                    now: historyTimestamp,
                    testFamily: 'microtest'
                };
                const first = completedHistoryRecord('first');
                await updateCompactHistory(store, {
                    ...first,
                    result: {
                        ...first.result,
                        perTest: [ { workId: historyWork, durationMicroseconds: 10, verdict: 'fail' } ]
                    }
                }, context);

                await updateCompactHistory(store, {
                    ...first,
                    id: 'second',
                    startedAt: '2026-10-29T00:00:01.000Z',
                    result: { ...first.result, perTest: [ { workId: historyWork, durationMicroseconds: 10, verdict } ] }
                }, context);
                const selection = await readLastFailedSelection({ kind: 'all' }, { projectRoot: '/project', config }, {
                    createHistoryStorage() {
                        return store;
                    },
                    wallClock: createDeterministicClock({
                        initialUnixEpochMicroseconds: BigInt(Date.parse(historyTimestamp)) * 1000n
                    })
                });
                scope.assert.equal(
                    selection.kind,
                    [ 'fail', 'crashed', 'process-exhausted', 'runtime-policy' ].includes(verdict) ? 'filter' : 'none'
                );
                return scope.assert.collect();
            });
        }
    ),
    test('empty selection survives copying and intersection', function (scope: TestScope) {
        const selection = resolveLastFailedSelection({ kind: 'all' }, []);
        scope.assert.deepEqual(selection, { kind: 'none' });
        scope.assert.deepEqual(copyRunSelection(selection), selection);
        scope.assert.equal(invalidRunSelectionMessage(selection), null);
        scope.assert.deepEqual(resolveLastFailedSelection({ kind: 'none' }, [ historyWork.case ]), selection);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
