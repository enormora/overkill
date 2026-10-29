import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { emptyCompactHistory, retainCompactHistory } from './compact-history.ts';

export const testNode = createSuite({
    title: 'compact history retention',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ createTestCase({
        title: 'applies both summary count and age limits without discarding pruned summaries',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        body(scope) {
            const now = '2026-10-29T00:00:00.000Z';
            const recent = {
                id: 'recent',
                startedAt: now,
                profile: 'unit',
                testFamily: 'microtest',
                status: 'passed' as const,
                durationMicroseconds: 10,
                replayable: false
            };
            const index = {
                ...emptyCompactHistory(now),
                summaries: [
                    { ...recent, id: 'expired', startedAt: '2026-01-01T00:00:00.000Z' },
                    { ...recent, id: 'older', startedAt: '2026-10-28T00:00:00.000Z' },
                    recent
                ]
            };
            scope.assert.deepEqual(
                retainCompactHistory(index, {
                    ...defaultHistoryPolicy,
                    runSummaryLimit: 1
                }, now)
                    .summaries,
                [ recent ]
            );
            return scope.assert.collect();
        }
    }) ]
});
await runIfMain(import.meta, testNode);
