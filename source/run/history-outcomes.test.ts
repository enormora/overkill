import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { completedHistoryRecord, historyTimestamp } from '../test-support/history-record-fixture.ts';
import { emptyCompactHistory, ingestCompactRecord } from './compact-history.ts';
import { historyRunSummary, recordDurationContributions, caseOutcomes } from './history-outcomes.ts';

const context = { policy: defaultHistoryPolicy, now: historyTimestamp, testFamily: 'microtest' };
export const testNode = suite('history outcomes', [
    test(
        'a failed variant wins over a passing variant without adding two case observations',
        function (scope: TestScope) {
            const record = completedHistoryRecord('run');
            const result = record.result.perTest[0];
            scope.require.defined(result);
            const variants = [ { ...result, verdict: 'fail' as const }, {
                ...result,
                workId: { ...result.workId, workload: { name: 'alternate', params: {} } }
            } ];
            const next = ingestCompactRecord(emptyCompactHistory(historyTimestamp), {
                ...record,
                result: { ...record.result, perTest: variants }
            }, context);
            scope.assert.equal(next.cases[0]?.counters.failed, 1);
            scope.assert.equal(next.cases[0]?.counters.passed, 0);
            scope.assert.equal(next.cases[0]?.observations.length, 1);
            return scope.assert.collect();
        }
    ),
    test(
        'run status applies interruption then runner errors then failures then inconclusive',
        function (scope: TestScope) {
            const record = completedHistoryRecord('run');
            const failed = { ...record.result, summary: { ...record.result.summary, failed: 1, inconclusive: 1 } };
            const runnerError = { ...failed, runnerErrors: [ 'infrastructure' ] };
            scope.assert.equal(
                historyRunSummary({ ...record, status: 'interrupted', result: runnerError }, 'microtest').status,
                'interrupted'
            );
            scope.assert.equal(
                historyRunSummary({ ...record, result: runnerError }, 'microtest').status,
                'runner-error'
            );
            scope.assert.equal(historyRunSummary({ ...record, result: failed }, 'microtest').status, 'failed');
            scope.assert.equal(
                historyRunSummary(
                    { ...record, result: { ...failed, summary: { ...failed.summary, failed: 0 } } },
                    'microtest'
                )
                    .status,
                'inconclusive'
            );
            return scope.assert.collect();
        }
    ),
    test('observation trimming preserves counters and removes stale identities', function (scope: TestScope) {
        let index = emptyCompactHistory(historyTimestamp);
        const observations = 25;
        for (let observation = 0; observation < observations; observation += 1) {
            index = ingestCompactRecord(index, completedHistoryRecord(`run-${observation}`), context);
        }
        scope.assert.equal(index.cases[0]?.observations.length, 20);
        scope.assert.equal(index.cases[0]?.counters.passed, observations);
        const later = '2027-02-01T00:00:00.000Z';
        const retained = ingestCompactRecord(index, {
            ...completedHistoryRecord('empty'),
            startedAt: later,
            result: { ...completedHistoryRecord('empty').result, perTest: [] }
        }, { ...context, now: later });
        scope.assert.deepEqual(retained.cases, []);
        return scope.assert.collect();
    }),
    test('unresolved attempts have no duration, replay source, or case observations', function (scope: TestScope) {
        const record = {
            ...completedHistoryRecord('unresolved'),
            status: 'started' as const,
            facts: null,
            result: null
        };
        const summary = historyRunSummary(record, 'microtest');
        scope.assert.equal(summary.durationMicroseconds, null);
        scope.assert.equal(summary.replayable, false);
        scope.assert.equal(caseOutcomes(record).size, 0);
        scope.assert.equal(recordDurationContributions(record).length, 0);
        scope.assert.equal(
            recordDurationContributions({ ...record, facts: { execution: { testFamily: 'microtest' } } }).length,
            0
        );
        return scope.assert.collect();
    }),
    test('invalid duration observations never enter scheduling history', function (scope: TestScope) {
        const record = completedHistoryRecord('invalid-duration');
        const perTest = [ Number.NaN, Number.POSITIVE_INFINITY, -1 ].flatMap(
            function invalidDuration(durationMicroseconds) {
                return record.result.perTest.map(function resultWithInvalidDuration(result) {
                    return { ...result, durationMicroseconds };
                });
            }
        );
        scope.assert.equal(recordDurationContributions({ ...record, result: { ...record.result, perTest } }).length, 0);
        return scope.assert.collect();
    }),
    test('worker observations retain lifecycle metadata across profiles', function (scope: TestScope) {
        const record = completedHistoryRecord('worker');
        const observations = recordDurationContributions({
            ...record,
            execution: { processModel: 'worker-pool', scheduling: 'serial', workerLifecycle: 'reuse' },
            facts: { execution: { testFamily: 'integration' } }
        });
        scope.assert.equal(observations[0]?.observation.metadata.workerLifecycle, 'reuse');
        scope.assert.equal(observations[0]?.observation.metadata.testFamily, 'integration');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
