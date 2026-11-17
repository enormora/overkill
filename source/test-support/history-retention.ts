import type { HistoryStorage } from '../run/history-storage-types.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import { emptyCompactHistory, ingestCompactRecord } from '../run/compact-history.ts';
import type { HistoryRetentionRuntime } from '../run/history-pruning.ts';
import { manifestSchema } from '../run/history-retention-metadata.ts';
import { durationStatePath, emptyDurationState } from '../run/duration-history-storage.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';
import { completedHistoryRecord } from './history-record-fixture.ts';

type HistoryRetentionScenario = {
    readonly missingIndex: boolean;
    readonly keepRecords: boolean;
    readonly durations: boolean;
    readonly expired: boolean;
    readonly removalFailure: Error | null;
};
export const historyRetentionScenario: HistoryRetentionScenario = {
    missingIndex: false,
    keepRecords: false,
    durations: false,
    expired: false,
    removalFailure: null
};
type HistoryRetentionFixture = {
    readonly context: {
        readonly directory: string;
        readonly policy: typeof defaultHistoryPolicy;
        readonly store: HistoryStorage;
    };
    readonly runtime: HistoryRetentionRuntime;
    readonly removed: readonly string[];
    readonly written: readonly string[];
    readonly initial: string;
};
const now = '2026-10-30T00:00:00.000Z';
const historyDirectory = '/project/state';
export async function historyRetention(input: HistoryRetentionScenario): Promise<HistoryRetentionFixture> {
    const memory = createMemoryHistoryStorage();
    const records = [ completedHistoryRecord('new'), {
        ...completedHistoryRecord('old'),
        startedAt: '2026-10-28T00:00:00.000Z'
    } ];
    const index = records.reduce(
        function (previous, record) {
            return ingestCompactRecord(previous, record, {
                policy: defaultHistoryPolicy,
                now,
                testFamily: 'microtest'
            });
        },
        emptyCompactHistory(now)
    );
    const written: string[] = [];
    const removed: string[] = [];
    if (!input.missingIndex) {
        await memory.write(`${historyDirectory}/history/index.json`, JSON.stringify(index));
    }
    if (input.durations) {
        await memory.write(durationStatePath(historyDirectory), JSON.stringify(emptyDurationState(now)));
    }
    return {
        context: {
            directory: historyDirectory,
            policy: {
                ...defaultHistoryPolicy,
                runSummaryLimit: 1,
                detailedRunLimit: input.keepRecords ? 1 : 0,
                successfulArtifactRunLimit: input.keepRecords ? 1 : 0
            },
            store: {
                ...memory,
                async write(target, content) {
                    written.push(target);
                    await memory.write(target, content);
                }
            }
        },
        runtime: {
            now() {
                return input.expired ? '2027-04-01T00:00:00.000Z' : now;
            },
            async catalog() {
                return {
                    records: records.map(function (record) {
                        return `${historyDirectory}/runs/${record.id}.json`;
                    }),
                    artifactDirectories: records.map(function (record) {
                        return `${historyDirectory}/runs/${record.id}`;
                    }),
                    metadata: new Map(
                        index.summaries.map(
                            function (summary) {
                                return [ summary.id, manifestSchema.parse({ version: 1, ...summary }) ];
                            }
                        )
                    )
                };
            },
            async remove(target) {
                if (input.removalFailure !== null) {
                    throw input.removalFailure;
                }
                removed.push(target);
            }
        },
        removed,
        written,
        initial: JSON.stringify(index)
    };
}
