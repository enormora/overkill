import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { HistoryPolicy } from '../config/history-policy.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { readCompactHistory } from './history-storage.ts';
import { historyStateError } from './history-state-error.ts';
import { retainCompactHistory } from './compact-history.ts';
import { readDurationState, durationStatePath, ingestDurationState } from './duration-history-storage.ts';
import { readRetentionCatalog, selectHistoryRemovals } from './history-retention-records.ts';
import type { HistoryPruneRequest, HistoryPruneResult } from './history-types.ts';

type PruneContext = { readonly directory: string; readonly policy: HistoryPolicy; readonly store: HistoryStorage; };
type RetentionWrite = Pick<PruneContext, 'directory' | 'store'> & {
    readonly next: ReturnType<typeof retainCompactHistory>;
    readonly nextDurations: Awaited<ReturnType<typeof readDurationState>>;
    readonly result: HistoryPruneResult;
    readonly metadata: Awaited<ReturnType<typeof readRetentionCatalog>>['metadata'];
    readonly artifactDirectories: readonly string[];
};
async function applyRetention(input: RetentionWrite): Promise<void> {
    const { store, directory, next, nextDurations, result, metadata, artifactDirectories } = input;
    const retainedArtifacts = artifactDirectories.filter(function (value) {
        return !result.paths.includes(value);
    });
    for (const target of retainedArtifacts) {
        await store.write(
            path.join(target, 'retention.json'),
            JSON.stringify(metadata.get(path.basename(target)))
        );
    }
    for (const target of result.paths) {
        await rm(target, { recursive: true, force: true });
    }
    if (nextDurations !== null) {
        await store.write(durationStatePath(directory), JSON.stringify(nextDurations));
    }
    await store.write(path.join(directory, 'history', 'index.json'), JSON.stringify(next));
}

async function requiredIndex(context: PruneContext): Promise<ReturnType<typeof retainCompactHistory>> {
    const index = await readCompactHistory(context.store, context.directory);
    if (index === null) {
        throw historyStateError('Compact history is missing.');
    }
    return index;
}
function currentTimestamp(): string {
    const now = new Date();
    return now.toISOString();
}
async function retainedDurations(context: PruneContext, now: string): Promise<RetentionWrite['nextDurations']> {
    const state = await readDurationState(context.store, context.directory, now);
    return state === null
        ? null
        : ingestDurationState(state, [], { run: null, policy: context.policy, now, source: 'repair' });
}
function removalResult(
    request: HistoryPruneRequest,
    paths: readonly string[],
    before: RetentionWrite['next'],
    after: RetentionWrite['next']
): HistoryPruneResult {
    return {
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
    const index = await requiredIndex(context);
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
                return { ...value, replayable: value.replayable && removals.retainedRecords.has(value.id) };
            })
        },
        context.policy,
        now
    );
    const durations = await readDurationState(context.store, context.directory, now);
    const nextDurations = await retainedDurations(context, now);
    const artifactDirectories = Array.from(
        new Set([
            ...catalog.artifactDirectories,
            ...Array
                .from(removals.successfulRuns, function successfulRunDirectory(id) {
                    return path.join(context.directory, 'runs', id);
                })
        ])
    );
    const result = removalResult(request, [ ...removals.removedRecords, ...removals.removedArtifacts ], index, next);
    return {
        ...context,
        next,
        nextDurations,
        metadata: catalog.metadata,
        artifactDirectories,
        result: {
            ...result,
            removedWorkEntries: (durations?.entries.length ?? 0) - (nextDurations?.entries.length ?? 0)
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
