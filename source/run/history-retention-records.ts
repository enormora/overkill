import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { HistoryPolicy } from '../config/history-policy.ts';
import { historyStateError } from './history-state-error.ts';
import type { CompactHistory } from './compact-history-schema.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { historyRecordSchema, type HistoryRecord } from './history-record.ts';
import { historyRunStatus } from './history-outcomes.ts';
import { historyDirectoryNames, compareHistoryRuns, assertHistoryRunId } from './history-state-access.ts';

const millisecondsPerDay = 86_400_000;
const manifestSchema = z.object({
    version: z.literal(1),
    id: z.string(),
    startedAt: z.iso.datetime({ offset: true }),
    status: z.enum([ 'passed', 'failed', 'runner-error', 'interrupted', 'inconclusive' ])
});

type Metadata = Readonly<z.output<typeof manifestSchema>>;
type Catalog = {
    readonly records: readonly string[];
    readonly artifactDirectories: readonly string[];
    readonly metadata: ReadonlyMap<string, Metadata>;
};
type RetainMetadata = (key: string, value: Metadata) => void;
type RecordCatalogInput = {
    readonly store: HistoryStorage;
    readonly runs: string;
    readonly index: CompactHistory;
    readonly policy: HistoryPolicy;
    readonly now: string;
};
async function artifactMetadata(
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
async function recordMetadata(input: RecordCatalogInput, recordPath: string): Promise<Metadata> {
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
async function readRecords(
    input: RecordCatalogInput,
    records: readonly string[],
    retain: RetainMetadata
): Promise<void> {
    for (const recordPath of records) {
        const record = await recordMetadata(input, recordPath);
        retain(record.id, record);
    }
}
async function artifactDirectory(
    input: RecordCatalogInput,
    metadata: ReadonlyMap<string, Metadata>,
    retain: RetainMetadata,
    name: string
): Promise<string | null> {
    const target = path.join(input.runs, name);
    const status = await lstat(target);
    if (!status.isDirectory()) {
        return null;
    }
    const parsed = await artifactMetadata(input.store, target, metadata.get(name), name);
    if (!metadata.has(name)) {
        retain(name, parsed);
    }
    return target;
}
async function readArtifacts(
    input: RecordCatalogInput,
    metadata: ReadonlyMap<string, Metadata>,
    retain: RetainMetadata
): Promise<readonly string[]> {
    const names = await historyDirectoryNames(input.runs);
    const directories = await Promise.all(names.map(async function inspectArtifact(name) {
        return await artifactDirectory(input, metadata, retain, name);
    }));
    return directories.filter(function existingDirectory(directory) {
        return directory !== null;
    });
}
export async function readRetentionCatalog(input: RecordCatalogInput): Promise<Catalog> {
    const metadata = new Map(input.index.summaries.map(function retainedSummary(summary): readonly [string, Metadata] {
        assertHistoryRunId(summary.id);
        return [ summary.id, manifestSchema.parse({ version: 1, ...summary }) ];
    }));
    function retainRunMetadata(key: string, value: Metadata): void {
        metadata.set(key, value);
    }
    const records = await input.store.list(input.runs);
    await readRecords(input, records, retainRunMetadata);
    const artifactDirectories = await readArtifacts(input, metadata, retainRunMetadata);
    return { metadata, records, artifactDirectories };
}
type Removals = {
    readonly successfulRuns: ReadonlySet<string>;
    readonly retainedRecords: ReadonlySet<string>;
    readonly removedRecords: readonly string[];
    readonly removedArtifacts: readonly string[];
};
export function selectHistoryRemovals(catalog: Catalog, runs: string, policy: HistoryPolicy, now: string): Removals {
    const { metadata, records, artifactDirectories } = catalog;
    const ordered = Array.from(metadata.values()).toSorted(compareHistoryRuns);
    const retainedRecords = new Set(
        ordered
            .filter(function (value) {
                return records.includes(path.join(runs, `${value.id}.json`));
            })
            .slice(0, policy.detailedRunLimit)
            .map(function (value) {
                return value.id;
            })
    );
    const successful = new Set(
        ordered
            .filter(function (value) {
                return value.status === 'passed';
            })
            .slice(0, policy.successfulArtifactRunLimit)
            .map(function (value) {
                return value.id;
            })
    );
    const removedRecords = records.filter(function (value) {
        return !retainedRecords.has(path.basename(value, '.json'));
    });
    const removedArtifacts = artifactDirectories.filter(function expired(target) {
        const value = metadata.get(path.basename(target));
        if (value === undefined) {
            throw new Error(`Missing metadata: ${target}`);
        }
        return value.status === 'passed'
            ? !successful.has(value.id)
            : Date.parse(value.startedAt) <
                Date.parse(now) - policy.failingArtifactRetentionDays * millisecondsPerDay;
    });

    return { retainedRecords, removedRecords, removedArtifacts, successfulRuns: successful };
}
