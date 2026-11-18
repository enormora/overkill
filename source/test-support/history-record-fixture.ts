import { currentRunRecordVersion } from '../run/run-record-format.ts';
import { recordedReplayProfile } from '../run/run-record-input.ts';
import type { HistoryRecord } from '../run/history-record.ts';
import { deterministicCollectedRunPlan } from './deterministic-run-fixtures.ts';
import { defaultMicrotestProfile } from './run-command-factory.ts';

export const historyWork = {
    familyVariant: null,
    case: { file: 'test.ts', params: null, suite: [], title: 'example' },
    runtimes: [],
    workload: null
} as const;

export const historyTimestamp = '2026-10-29T00:00:00.000Z';

export type CompletedHistoryFixture = Extract<HistoryRecord, { readonly status: 'completed'; }> & {
    readonly facts: { readonly implementations: null; };
};

export function historyFacts(
    testFamily: string
): NonNullable<HistoryRecord['facts']> & { readonly implementations: null; } {
    return {
        environment: null,
        benchmarkHost: null,
        benchmarkPlacement: null,
        benchmarkCalibration: null,
        benchmarkNormalization: null,
        execution: { testFamily },
        implementations: null
    };
}

export function completedHistoryRecord(id: string): CompletedHistoryFixture {
    return {
        id,
        kind: 'single',
        version: currentRunRecordVersion,
        detail: 'detailed',
        identities: null,
        versions: null,
        replayPlan: deterministicCollectedRunPlan('test.ts'),
        replayProfile: recordedReplayProfile(
            defaultMicrotestProfile({ execution: { processModel: 'in-process', scheduling: 'serial' } })
        ),
        status: 'completed',
        startedAt: historyTimestamp,
        request: { profile: 'unit', recordForMerge: false },
        execution: { processModel: 'in-process', scheduling: 'serial' },
        facts: historyFacts('microtest'),
        result: {
            preparationFacts: null,
            baselineReports: [],
            resourceChecks: [],
            status: 'passed',
            runnerErrors: [],
            summary: {
                defined: 1,
                discovered: 1,
                planned: 1,
                passed: 1,
                skipped: 0,
                failed: 0,
                crashed: 0,
                processExhausted: 0,
                runtimePolicy: 0,
                inconclusive: 0
            },
            timings: {
                summary: {
                    totalWallTimeMicroseconds: 100,
                    runnerOverheadWallTimeMicroseconds: 0,
                    testExecutionWallTimeMicroseconds: 100
                }
            },
            perTest: [ {
                benchmark: null,
                verdict: 'pass',
                durationMicroseconds: 10,
                workId: historyWork
            } ]
        }
    };
}
