import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { historyTimestamp, historyWork } from '../test-support/history-record-fixture.ts';
import { durationIndexProjection, emptyDurationState, ingestDurationState } from './duration-history-storage.ts';

const observation = {
    work: historyWork,
    observation: {
        durationMicroseconds: 10,
        observedAt: historyTimestamp,
        metadata: {
            profile: 'unit',
            testFamily: 'microtest',
            processModel: 'in-process',
            scheduling: 'serial',
            workerLifecycle: null
        }
    }
} as const;
const context = { now: historyTimestamp, policy: defaultHistoryPolicy };

export const testNode = suite('duration history retention', [
    test('placement excludes uncommitted runs while retaining independent observations', function (scope: TestScope) {
        const pending = ingestDurationState(emptyDurationState(historyTimestamp), [ observation ], {
            ...context,
            run: { id: 'pending', startedAt: historyTimestamp }
        });
        const independent = ingestDurationState(pending, [ observation ], { ...context, run: null });
        scope.assert.deepEqual<unknown, unknown>(
            durationIndexProjection(independent, new Set()).entries[0]?.observations,
            [
                observation.observation
            ]
        );
        scope.assert.deepEqual<unknown, unknown>(
            durationIndexProjection(independent, new Set([ 'pending' ])).entries[0]?.observations,
            [
                observation.observation,
                observation.observation
            ]
        );
        return scope.assert.collect();
    }),
    test('equal timestamps retain deterministic run order including independent samples', function (scope: TestScope) {
        const initial = {
            ...emptyDurationState(historyTimestamp),
            entries: [ {
                work: historyWork,
                count: 3,
                totalDurationMicroseconds: 30,
                observations: [ 'b', null, 'a' ].map(function sample(runId) {
                    return { runId, value: observation.observation };
                })
            } ]
        };
        const retained = ingestDurationState(initial, [], { ...context, run: null });
        scope.assert.deepEqual<unknown, unknown>(
            retained.entries[0]?.observations.map(function identity(sample) {
                return sample.runId;
            }),
            [ null, 'a', 'b' ]
        );
        const reversed = {
            ...initial,
            entries: initial.entries.map(function reverse(entry) {
                return { ...entry, observations: entry.observations.toReversed() };
            })
        };
        scope.assert.deepEqual<unknown, unknown>(
            ingestDurationState(reversed, [], { ...context, run: null }),
            retained
        );
        scope.assert.equal(retained.entries[0]?.count, 3);
        scope.assert.equal(retained.entries[0]?.totalDurationMicroseconds, 30);
        return scope.assert.collect();
    }),
    test('observation trimming preserves counts and accumulated duration', function (scope: TestScope) {
        let state = emptyDurationState(historyTimestamp);
        for (let index = 0; index < 25; index += 1) {
            state = ingestDurationState(state, [ observation ], {
                ...context,
                run: { id: `run-${index}`, startedAt: historyTimestamp }
            });
        }
        scope.assert.equal(state.entries[0]?.observations.length, 20);
        scope.assert.equal(state.entries[0]?.count, 25);
        scope.assert.equal(state.entries[0]?.totalDurationMicroseconds, 250);
        return scope.assert.collect();
    }),
    test('expired records cannot resurrect old work history', function (scope: TestScope) {
        const state = ingestDurationState(emptyDurationState(historyTimestamp), [ observation ], {
            ...context,
            run: { id: 'expired', startedAt: '2026-01-01T00:00:00.000Z' }
        });
        scope.assert.equal(state.entries.length, 0);
        return scope.assert.collect();
    }),
    test('stale work entries are pruned', function (scope: TestScope) {
        const earlier = '2026-01-01T00:00:00.000Z';
        const initial = ingestDurationState(emptyDurationState(earlier), [ {
            ...observation,
            observation: { ...observation.observation, observedAt: earlier }
        } ], { ...context, now: earlier, run: { id: 'old', startedAt: earlier } });
        const retained = ingestDurationState(initial, [], { ...context, run: null });
        scope.assert.equal(retained.entries.length, 0);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
