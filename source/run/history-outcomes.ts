import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { DurationContribution } from './duration-history-storage.ts';
import type { HistoryRecord } from './history-record.ts';
import type { CaseHistoryStatus, HistoryRunSummary } from './compact-history-schema.ts';

type CaseOutcome = { readonly identity: CaseId; readonly status: CaseHistoryStatus; };
const precedence: Readonly<Record<CaseHistoryStatus, number>> = { failed: 4, inconclusive: 3, passed: 2, skipped: 1 };
const verdictStatus = {
    pass: 'passed',
    skip: 'skipped',
    inconclusive: 'inconclusive',
    fail: 'failed',
    crashed: 'failed',
    'process-exhausted': 'failed',
    'runtime-policy': 'failed'
} as const;

function completedRunStatus(result: NonNullable<HistoryRecord['result']>): HistoryRunSummary['status'] {
    if (result.runnerErrors.length > 0) {
        return 'runner-error';
    }
    const counts = result.summary;
    if (counts.failed + counts.crashed + counts.processExhausted + counts.runtimePolicy > 0) {
        return 'failed';
    }
    return counts.inconclusive > 0 ? 'inconclusive' : 'passed';
}

export function historyRunStatus(record: HistoryRecord): HistoryRunSummary['status'] {
    return record.status === 'completed' ? completedRunStatus(record.result) : 'interrupted';
}
export function historyRunSummary(record: HistoryRecord, testFamily: string): HistoryRunSummary {
    return {
        id: record.id,
        startedAt: record.startedAt,
        profile: record.request.profile,
        testFamily,
        status: historyRunStatus(record),
        durationMicroseconds: record.result?.timings.summary.totalWallTimeMicroseconds ?? null,
        replayable: record.facts !== null
    };
}

export function caseOutcomes(record: HistoryRecord): ReadonlyMap<string, CaseOutcome> {
    const outcomes = new Map<string, CaseOutcome>();
    const results = record.result?.perTest ?? [];
    for (const result of results) {
        const identity = result.workId.case;
        const key = caseIdentityKey(identity);
        const status = verdictStatus[result.verdict];
        const previous = outcomes.get(key);
        if (previous === undefined || precedence[status] > precedence[previous.status]) {
            outcomes.set(key, { identity, status });
        }
    }
    return outcomes;
}

export function recordDurationContributions(
    record: HistoryRecord
): readonly DurationContribution[] {
    const family = record.facts?.execution.testFamily;
    if (family === undefined) {
        return [];
    }
    const { execution } = record;
    return (record.result?.perTest ?? []).flatMap(function durationObservation(result) {
        if (!Number.isFinite(result.durationMicroseconds) || result.durationMicroseconds < 0) {
            return [];
        }
        return [ {
            work: result.workId,
            observation: {
                durationMicroseconds: result.durationMicroseconds,
                observedAt: record.startedAt,
                metadata: {
                    profile: record.request.profile,
                    testFamily: family,
                    processModel: execution.processModel,
                    scheduling: execution.scheduling,
                    workerLifecycle: execution.processModel === 'worker-pool'
                        ? execution.workerLifecycle
                        : null
                }
            }
        } ];
    });
}
