import { createRetentionCatalogReader, type RetentionCatalog } from '../run/history-retention-records.ts';
import { emptyCompactHistory } from '../run/compact-history.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import type { RecordCatalogInput } from '../run/history-retention-metadata.ts';
import type { HistoryRecord } from '../run/history-record.ts';
import type { HistoryStorage } from '../run/history-storage-types.ts';
import { completedHistoryRecord, historyTimestamp } from './history-record-fixture.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';

type UnavailableRecord = 'mismatch' | 'missing' | 'uncommitted';
type RetainedRecord = UnavailableRecord | 'complete' | 'interrupted' | 'merge' | 'stale';
type RetainedArtifact = 'directory' | 'file' | 'manifest' | 'mismatch' | 'none' | 'unclassified';
export type RetentionCatalogScenario = {
    readonly record: RetainedRecord;
    readonly artifact: RetainedArtifact;
    readonly indexed: boolean;
};
export const retentionCatalogScenario: RetentionCatalogScenario = {
    record: 'complete',
    artifact: 'directory',
    indexed: true
};
type RetentionCatalogFixture = { readonly read: () => Promise<RetentionCatalog>; readonly input: RecordCatalogInput; };
const now = '2026-10-30T00:00:00.000Z';
const runs = '/project/state/runs';
function retainedRecord(scenario: RetainedRecord): HistoryRecord {
    const original = completedHistoryRecord(scenario === 'mismatch' ? 'different' : 'retained');
    if (scenario === 'interrupted') {
        return { ...original, status: 'interrupted' };
    }
    return {
        ...original,
        startedAt: scenario === 'stale' ? '2020-01-01T00:00:00.000Z' : original.startedAt,
        request: { ...original.request, recordForMerge: scenario === 'merge' }
    };
}
function catalogIndex(scenario: RetentionCatalogScenario): RecordCatalogInput['index'] {
    return {
        ...emptyCompactHistory(now),
        receipts: scenario.record === 'complete'
            ? [ { id: 'retained', startedAt: historyTimestamp, state: 'completed' } ]
            : [],
        summaries: scenario.indexed
            ? [ {
                id: 'retained',
                startedAt: historyTimestamp,
                status: 'passed',
                profile: 'unit',
                testFamily: 'microtest',
                replayable: true,
                durationMicroseconds: 100
            } ]
            : []
    };
}
function artifactName(artifact: RetainedArtifact): string {
    return [ 'manifest', 'unclassified' ].includes(artifact) ? 'orphan' : 'retained';
}
async function seedArtifact(store: HistoryStorage, artifact: RetainedArtifact, name: string): Promise<void> {
    if (artifact === 'manifest' || artifact === 'mismatch') {
        await store.write(
            `${runs}/${name}/retention.json`,
            JSON.stringify({
                version: 1,
                id: artifact === 'mismatch' ? 'different' : name,
                startedAt: historyTimestamp,
                status: 'passed'
            })
        );
    }
}
export async function retentionCatalog(scenario: RetentionCatalogScenario): Promise<RetentionCatalogFixture> {
    const memory = createMemoryHistoryStorage();
    const record = retainedRecord(scenario.record);
    const recordPaths = scenario.record === 'missing' ? [] : [ `${runs}/retained.json` ];
    for (const file of recordPaths) {
        await memory.write(file, JSON.stringify(record));
    }
    const input: RecordCatalogInput = {
        store: {
            ...memory,
            async list() {
                return recordPaths;
            }
        },
        runs,
        now,
        policy: defaultHistoryPolicy,
        index: catalogIndex(scenario)
    };
    const name = artifactName(scenario.artifact);
    await seedArtifact(memory, scenario.artifact, name);
    const read = createRetentionCatalogReader({
        async names() {
            return scenario.artifact === 'none' ? [] : [ name ];
        },
        async status() {
            return {
                isDirectory() {
                    return scenario.artifact !== 'file';
                }
            };
        }
    });
    return {
        input,
        async read() {
            return await read(input);
        }
    };
}
