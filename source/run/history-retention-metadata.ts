import path from 'node:path';
import { z } from 'zod';
import type { HistoryOptions } from './history-types.ts';
import type { CompactHistory } from './compact-history-schema.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { historyStateError } from './history-state-error.ts';
import { historyRecordSchema, type HistoryRecord } from './history-record.ts';
import { historyRunStatus } from './history-outcomes.ts';

const millisecondsPerDay = 86_400_000;
export const manifestSchema = z.object({
    version: z.literal(1),
    id: z.string(),
    startedAt: z.iso.datetime({ offset: true }),
    status: z.enum([ 'passed', 'failed', 'runner-error', 'interrupted', 'inconclusive' ])
});

export type Metadata = Readonly<z.output<typeof manifestSchema>>;
export type RecordCatalogInput = {
    readonly store: HistoryStorage;
    readonly runs: string;
    readonly index: CompactHistory;
    readonly policy: HistoryOptions['config']['history'];
    readonly now: string;
};
export async function artifactMetadata(
    store: HistoryStorage,
    target: string,
    fallback: Metadata | undefined,
    name: string
): Promise<Metadata> {
    const source = await store.read(path.join(target, 'retention.json'));
    const value: unknown = source === null ? fallback : JSON.parse(source);
    if (value === undefined) {
        throw new Error(`Missing artifact retention metadata: ${target}`);
    }
    const parsed = manifestSchema.parse(value);
    if (parsed.id !== name) {
        throw new Error(`Artifact identity does not match path: ${target}`);
    }

    return parsed;
}

function assertRecordCommitted(record: HistoryRecord, input: RecordCatalogInput): void {
    if (record.status !== 'completed') {
        return;
    }
    const cutoff = Date.parse(input.now) - input.policy.staleIdentityRetentionDays * millisecondsPerDay;
    if (Date.parse(record.startedAt) < cutoff) {
        return;
    }
    const receipt = input.index.receipts.find(function (value) {
        return value.id === record.id;
    });
    if (receipt?.state !== 'completed') {
        throw historyStateError(`Run ${record.id} has an incomplete history commit.`);
    }
}
export async function recordMetadata(input: RecordCatalogInput, recordPath: string): Promise<Metadata> {
    const { store } = input;
    const record = historyRecordSchema.parse(JSON.parse(await store.read(recordPath) ?? 'null'));
    if (path.basename(recordPath) !== `${record.id}.json`) {
        throw new Error(`Record identity does not match path: ${recordPath}`);
    }
    assertRecordCommitted(record, input);
    return manifestSchema.parse({
        version: 1,
        id: record.id,
        startedAt: record.startedAt,
        status: historyRunStatus(record)
    });
}
