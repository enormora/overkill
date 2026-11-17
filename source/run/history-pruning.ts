import { rm } from 'node:fs/promises';
import path from 'node:path';
import { compactRunRecord } from './compact-run-record.ts';
import type { RecordCatalogInput } from './history-retention-metadata.ts';
import { checkHistoryMaintenanceBudget } from './history-maintenance-budget.ts';
import { readRequiredCompactHistory } from './history-storage.ts';
import { retainCompactHistory } from './compact-history.ts';
import { ingestDurationState } from './duration-history-storage.ts';
import { readRetentionCatalog, selectHistoryRemovals } from './history-retention-records.ts';
import type { HistoryOptions, HistoryPruneRequest, HistoryPruneResult } from './history-types.ts';

type PruneContext = {
    readonly directory: string;
    readonly policy: HistoryOptions['config']['history'];
    readonly store: RecordCatalogInput['store'];
};
type RetentionWrite = Pick<PruneContext, 'directory' | 'store'> & {
    readonly next: ReturnType<typeof retainCompactHistory>;
    readonly nextDurations: RetentionWrite['next']['durations'];
    readonly downgrades: readonly string[];
    readonly result: HistoryPruneResult;
    readonly metadata: Awaited<ReturnType<typeof readRetentionCatalog>>['metadata'];
    readonly artifactDirectories: readonly string[];
};
async function writeArtifactRetention(input: RetentionWrite): Promise<void> {
    const { store, metadata, artifactDirectories, result } = input;
    const retainedArtifacts = artifactDirectories.filter(function retainedArtifact(value) {
        return !result.paths.includes(value);
    });
    for (const target of retainedArtifacts) {
        checkHistoryMaintenanceBudget();
        await store.write(path.join(target, 'retention.json'), JSON.stringify(metadata.get(path.basename(target))));
    }
}
async function compactDetailedRecords(input: RetentionWrite): Promise<void> {
    for (const file of input.downgrades) {
        checkHistoryMaintenanceBudget();
        const source = await input.store.read(file);
        if (source === null) {
            throw new Error('Record disappeared during retention.');
        }
        checkHistoryMaintenanceBudget();
        await input.store.write(file, JSON.stringify(compactRunRecord(JSON.parse(source))));
    }
}
async function applyRetention(input: RetentionWrite): Promise<void> {
    const { store, directory, next, nextDurations, result } = input;
    await writeArtifactRetention(input);
    await compactDetailedRecords(input);
    for (const target of result.paths) {
        checkHistoryMaintenanceBudget();
        await rm(target, { recursive: true, force: true });
    }
    await store.write(
        path.join(directory, 'history', 'index.json'),
        JSON.stringify({ ...next, durations: nextDurations })
    );
}

function currentTimestamp(): string {
    const now = new Date();
    return now.toISOString();
}
function removalResult(
    request: HistoryPruneRequest,
    paths: readonly string[],
    before: RetentionWrite['next'],
    after: RetentionWrite['next']
): HistoryPruneResult {
    return {
        compactedRecords: 0,
        kind: request.dryRun ? 'dry-run' : 'applied',
        diagnostics: [],
        paths,
        removedSummaries: before.summaries.length - after.summaries.length,
        removedCases: before.cases.length - after.cases.length,
        removedWorkEntries: 0
    };
}
async function prepareRetention(context: PruneContext, request: HistoryPruneRequest): Promise<RetentionWrite> {
    const now = currentTimestamp();
    const index = await readRequiredCompactHistory(context.store, context.directory);
    const catalog = await readRetentionCatalog({
        store: context.store,
        runs: path.join(context.directory, 'runs'),
        index,
        policy: context.policy,
        now
    });
    const removals = selectHistoryRemovals(catalog, path.join(context.directory, 'runs'), context.policy, now);
    const next = retainCompactHistory(
        {
            ...index,
            summaries: index.summaries.map(function replayAvailability(value) {
                return { ...value, replayable: value.replayable && removals.detailedRecords.has(value.id) };
            })
        },
        context.policy,
        now
    );
    const nextDurations = ingestDurationState(index.durations, [], {
        run: null,
        policy: context.policy,
        now
    });
    const artifactDirectories = Array.from(
        new Set([
            ...catalog.artifactDirectories,
            ...Array
                .from(removals.successfulRuns, function successfulRunDirectory(id) {
                    return path.join(context.directory, 'runs', id);
                })
        ])
    );
    const downgrades = catalog.records.filter(function expiredDetails(file) {
        const id = path.basename(file, '.json');
        return removals.retainedRecords.has(id) && !removals.detailedRecords.has(id) &&
            catalog.metadata.get(id)?.detail === 'detailed';
    });
    const result = removalResult(request, [ ...removals.removedRecords, ...removals.removedArtifacts ], index, next);
    return {
        ...context,
        downgrades,
        next,
        nextDurations,
        metadata: catalog.metadata,
        artifactDirectories,
        result: {
            ...result,
            compactedRecords: downgrades.length,
            removedWorkEntries: index.durations.entries.length - nextDurations.entries.length
        }
    };
}
export async function pruneHistory(context: PruneContext, request: HistoryPruneRequest): Promise<HistoryPruneResult> {
    const write = await prepareRetention(context, request);
    if (!request.dryRun) {
        await applyRetention(write);
    }
    return write.result;
}
