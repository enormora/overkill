import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { HistoryOptions } from './history-types.ts';
import { checkHistoryMaintenanceBudget } from './history-maintenance-budget.ts';
import { historyDirectoryNames, compareHistoryRuns, assertHistoryRunId } from './history-state-access.ts';
import {
    manifestSchema,
    recordMetadata,
    artifactMetadata,
    type Metadata,
    type RecordCatalogInput
} from './history-retention-metadata.ts';

const millisecondsPerDay = 86_400_000;
type Catalog = {
    readonly records: readonly string[];
    readonly artifactDirectories: readonly string[];
    readonly metadata: ReadonlyMap<string, Metadata>;
};
type RetainMetadata = (key: string, value: Metadata) => void;
async function readRecords(
    input: RecordCatalogInput,
    records: readonly string[],
    retain: RetainMetadata
): Promise<void> {
    for (const recordPath of records) {
        checkHistoryMaintenanceBudget();
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
    const directories: (string | null)[] = [];
    for (const name of names) {
        checkHistoryMaintenanceBudget();
        directories.push(await artifactDirectory(input, metadata, retain, name));
    }
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
export function selectHistoryRemovals(
    catalog: Catalog,
    runs: string,
    policy: HistoryOptions['config']['history'],
    now: string
): Removals {
    checkHistoryMaintenanceBudget();
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
