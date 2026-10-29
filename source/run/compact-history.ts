import { caseIdentityKey } from '../engine/identity.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import type { CompactHistory } from './compact-history-schema.ts';
import { historyRunSummary, caseOutcomes } from './history-outcomes.ts';
import type { HistoryRecord } from './history-record.ts';

const millisecondsPerDay = 86_400_000;

export function emptyCompactHistory(now: string): CompactHistory {
    return { version: 1, updatedAt: now, summaries: [], receipts: [], cases: [] };
}

function recent(timestampValue: string, now: string, days: number): boolean {
    return Date.parse(timestampValue) >= Date.parse(now) - days * millisecondsPerDay;
}

function newest<T extends { readonly startedAt: string; readonly id: string; }>(left: T, right: T): number {
    const timeOrder = Date.parse(right.startedAt) - Date.parse(left.startedAt);
    return timeOrder === 0 ? left.id.localeCompare(right.id) : timeOrder;
}

export function retainCompactHistory(index: CompactHistory, policy: HistoryPolicy, now: string): CompactHistory {
    return {
        ...index,
        updatedAt: now,
        summaries: index
            .summaries
            .filter(function withinSummaryWindow(value) {
                return recent(value.startedAt, now, policy.runSummaryRetentionDays);
            })
            .toSorted(newest)
            .slice(0, policy.runSummaryLimit),
        receipts: index.receipts.filter(function withinIdentityWindow(value) {
            return recent(value.startedAt, now, policy.staleIdentityRetentionDays);
        }),
        cases: index.cases.flatMap(function retainIdentity(entry) {
            const observations = entry
                .observations
                .toSorted(function latest(left, right) {
                    const timeOrder = Date.parse(right.observedAt) - Date.parse(left.observedAt);
                    return timeOrder === 0 ? left.runId.localeCompare(right.runId) : timeOrder;
                })
                .slice(0, policy.observationsPerIdentity);
            const latest = observations[0];
            return latest === undefined || !recent(latest.observedAt, now, policy.staleIdentityRetentionDays)
                ? []
                : [ { ...entry, observations } ];
        })
    };
}

type IngestionContext = { readonly policy: HistoryPolicy; readonly now: string; readonly testFamily: string; };

function shouldIngestCases(index: CompactHistory, record: HistoryRecord, context: IngestionContext): boolean {
    const existingReceipt = index.receipts.find(function sameRun(value) {
        return value.id === record.id;
    });
    return record.status === 'completed' && existingReceipt?.state !== 'completed' &&
        recent(record.startedAt, context.now, context.policy.staleIdentityRetentionDays);
}

export function ingestCompactRecord(
    index: CompactHistory,
    record: HistoryRecord,
    context: IngestionContext
): CompactHistory {
    const { policy, now, testFamily } = context;
    const cases = new Map(index.cases.map(function caseEntry(value) {
        return [ caseIdentityKey(value.identity), value ];
    }));
    if (shouldIngestCases(index, record, context)) {
        for (const [ key, value ] of caseOutcomes(record)) {
            const previous = cases.get(key) ?? {
                identity: value.identity,
                observations: [],
                counters: { failed: 0, inconclusive: 0, passed: 0, skipped: 0 }
            };
            cases.set(key, {
                identity: value.identity,
                observations: [ ...previous.observations, {
                    runId: record.id,
                    observedAt: record.startedAt,
                    status: value.status
                } ],
                counters: { ...previous.counters, [value.status]: previous.counters[value.status] + 1 }
            });
        }
    }
    return retainCompactHistory(
        {
            ...index,
            cases: Array.from(cases.values()),
            summaries: [
                ...index.summaries.filter(function otherRun(value) {
                    return value.id !== record.id;
                }),
                historyRunSummary(record, testFamily)
            ],
            receipts: [
                ...index.receipts.filter(function otherRun(value) {
                    return value.id !== record.id;
                }),
                {
                    id: record.id,
                    startedAt: record.startedAt,
                    state: record.status === 'started' ? 'provisional' : record.status
                }
            ]
        },
        policy,
        now
    );
}
