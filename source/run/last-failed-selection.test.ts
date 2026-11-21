import { table, suite, test } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { normalizeConfig } from '../config/config.ts';
import { completedHistoryRecord, historyTimestamp, historyWork } from '../test-support/history-record-fixture.ts';
import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import { resolveLastFailedSelection } from './run-selection.ts';
import { updateCompactHistory } from './history-storage.ts';
import { readLastFailedSelection } from './last-failed-selection.ts';
import { copyRunSelection, invalidRunSelectionMessage, matchesRunFilter, title } from './run-selection-filters.ts';

export const testNode = suite('last-failed selection', [
    table({
        title: 'intersects title selection with historical identities',
        cases: [ 'example', 'unrelated' ] as const,
        caseTitle(value) {
            return value;
        },
        test(scope) {
            const value = scope.parameters;

            const selection = resolveLastFailedSelection({ kind: 'filter', filter: title(value) }, [
                historyWork.case
            ]);
            if (selection.kind !== 'filter') {
                throw new Error('Expected an intersection of title and failed identities.');
            }
            const candidates = [ historyWork.case, { ...historyWork.case, file: 'other.ts' } ];
            const selected = candidates.filter(function matchesSelection(id) {
                return matchesRunFilter(selection.filter, {
                    annotations: { ownership: [], tags: [] },
                    id,
                    workId: { ...historyWork, case: id }
                });
            });
            scope.assert.deepEqual(selected, value === 'example' ? [ historyWork.case ] : []);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'uses the latest verdict for selection',
        cases: [ 'pass', 'skip', 'inconclusive', 'fail', 'crashed', 'process-exhausted', 'runtime-policy' ] as const,
        caseTitle(verdict) {
            return verdict;
        },
        async test(scope) {
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
                    perTest: [ { benchmark: null, workId: historyWork, durationMicroseconds: 10, verdict: 'fail' } ]
                }
            }, context);

            await updateCompactHistory(store, {
                ...first,
                id: 'second',
                startedAt: '2026-10-29T00:00:01.000Z',
                result: {
                    ...first.result,
                    perTest: [ {
                        benchmark: null,
                        workId: historyWork,
                        durationMicroseconds: 10,
                        verdict: scope.parameters
                    } ]
                }
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
                [ 'fail', 'crashed', 'process-exhausted', 'runtime-policy' ].includes(scope.parameters)
                    ? 'filter'
                    : 'none'
            );
            return scope.assert.collect();
        }
    }),
    test('empty selection survives copying and intersection', function (scope) {
        const selection = resolveLastFailedSelection({ kind: 'all' }, []);
        scope.assert.deepEqual(selection, { kind: 'none' });
        scope.assert.deepEqual(copyRunSelection(selection), selection);
        scope.assert.equal(invalidRunSelectionMessage(selection), null);
        scope.assert.deepEqual(resolveLastFailedSelection({ kind: 'none' }, [ historyWork.case ]), selection);
        return scope.assert.collect();
    })
]);
