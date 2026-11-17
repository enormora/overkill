import { summarizeBaselineReports } from './baseline-report-schema.ts';
import { historyRecordSchema } from './history-record.ts';

import type { CompactRunRecord } from './run-record-types.ts';

export function compactRunRecord(input: unknown): CompactRunRecord {
    const record = historyRecordSchema.parse(input);
    const value = {
        version: record.version,
        detail: 'compact' as const,
        kind: record.kind,
        id: record.id,
        startedAt: record.startedAt,
        status: record.status,
        versions: record.versions,
        identities: record.identities,
        execution: record.execution,
        request: record.request,
        facts: record.facts === null ? null : {
            ...record.facts,
            execution: {
                ...record.facts.execution,
                ...record.execution,
                testFamily: record.facts.execution.testFamily,
                profile: record.request.profile
            },
            implementations: null
        },
        replayPlan: null,
        replayProfile: null,
        evidence: 'summaries' as const,
        result: record.result === null ? null : {
            preparationFacts: record.result.preparationFacts,
            baselineReports: summarizeBaselineReports(record.result.baselineReports),
            status: record.result.status,
            summary: record.result.summary,
            timings: { summary: record.result.timings.summary },
            resourceChecks: record.result.resourceChecks,
            runnerErrors: record.result.runnerErrors,
            perTest: record.result.perTest.map(function outcome(test) {
                return {
                    workId: test.workId,
                    verdict: test.verdict,
                    durationMicroseconds: test.durationMicroseconds,
                    benchmark: test.benchmark
                };
            })
        }
    };
    if (value.status === 'completed') {
        if (value.result === null) {
            throw new Error('Completed compact records require a result.');
        }
        return { ...value, status: 'completed', result: value.result };
    }
    return { ...value, status: value.status };
}
