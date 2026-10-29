import type { HistoryRecord } from '../run/history-record.ts';

export const historyWork = {
    case: { file: 'test.ts', params: null, suite: [], title: 'example' },
    runtimes: [],
    workload: null
} as const;

export const historyTimestamp = '2026-10-29T00:00:00.000Z';

export function completedHistoryRecord(id: string): Extract<HistoryRecord, { readonly status: 'completed'; }> {
    return {
        id,
        kind: 'single',
        version: 1,
        status: 'completed',
        startedAt: historyTimestamp,
        request: { profile: 'unit' },
        execution: { processModel: 'in-process', scheduling: 'serial' },
        facts: { execution: { testFamily: 'microtest' } },
        result: {
            runnerErrors: [],
            summary: { failed: 0, crashed: 0, processExhausted: 0, runtimePolicy: 0, inconclusive: 0 },
            timings: { summary: { totalWallTimeMicroseconds: 100 } },
            perTest: [ {
                verdict: 'pass',
                durationMicroseconds: 10,
                workId: historyWork
            } ]
        }
    };
}
