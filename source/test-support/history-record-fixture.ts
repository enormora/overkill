import { currentRunRecordVersion } from '../run/run-record-format.ts';
import { recordedReplayProfile } from '../run/run-record-input.ts';
import type { HistoryRecord } from '../run/history-record.ts';
import { deterministicCollectedRunPlan } from './deterministic-run-fixtures.ts';
import { defaultMicrotestProfile } from './run-command-factory.ts';

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
        version: currentRunRecordVersion,
        replayPlan: deterministicCollectedRunPlan('test.ts'),
        replayProfile: recordedReplayProfile(
            defaultMicrotestProfile({ execution: { processModel: 'in-process', scheduling: 'serial' } })
        ),
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
