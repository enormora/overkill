import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
    createHistoryAccess,
    compareHistoryRuns,
    assertHistoryRunId,
    detailedRecordState,
    type DetailedRecordState
} from './history-state-access.ts';
import { readCompactHistory } from './history-storage.ts';
import { historyStateError, historySchemaVersion } from './history-state-error.ts';
import { repairHistory, type HistoryRepairResult } from './history-repair.ts';
import { pruneHistory } from './history-pruning.ts';
import type {
    HistoryOptions,
    HistoryRunSummary,
    HistoryPruneRequest,
    HistoryPruneResult,
    HistoryClearRequest,
    HistoryClearResult,
    History
} from './history-types.ts';

function replayAvailability(
    availability: DetailedRecordState,
    replayable: boolean,
    status: HistoryRunSummary['status']
): HistoryRunSummary['replay'] {
    if (availability === 'pruned') {
        return 'pruned';
    }
    if (availability === 'unavailable' || !replayable) {
        return 'unavailable';
    }
    return status === 'interrupted' ? 'available-interrupted' : 'available';
}

function currentTimestamp(): string {
    const now = new Date();
    return now.toISOString();
}

export function createHistory(options: HistoryOptions): History {
    const {
        directory,
        policy,
        store,
        runs,
        guarded,
        assertIdle,
        assertOwnedLocation,
        diagnostics,
        removeAbandonedOwners
    } = createHistoryAccess(options);
    async function repair(mode: 'automatic' | 'explicit'): Promise<HistoryRepairResult> {
        const result = await repairHistory({
            ...store,
            async withLock(operation) {
                return await guarded(async function repairIdleHistory() {
                    await assertOwnedLocation();
                    await assertIdle();
                    const operationResult = await operation();
                    if (mode === 'explicit') {
                        await removeAbandonedOwners();
                    }
                    return operationResult;
                });
            }
        }, { directory, policy, now: currentTimestamp(), mode });
        return { ...result, diagnostics: [ ...diagnostics(), ...result.diagnostics ] };
    }
    return {
        async list(): Promise<readonly HistoryRunSummary[]> {
            const source = await guarded(async function readHistorySource() {
                return await store.read(path.join(directory, 'history', 'index.json'));
            });
            if (source !== null && historySchemaVersion(source) === 0) {
                await repair('automatic');
            }
            return await guarded(async function listHistory() {
                const index = await readCompactHistory(store, directory);
                if (index === null) {
                    throw historyStateError('Compact history is missing.');
                }
                return await Promise.all(
                    index
                        .summaries
                        .toSorted(compareHistoryRuns)
                        .map(async function publicSummary(summary) {
                            const { replayable, ...fields } = summary;
                            assertHistoryRunId(summary.id);
                            const availability = await detailedRecordState(path.join(runs, `${summary.id}.json`));
                            const replay = replayAvailability(availability, replayable, summary.status);
                            return { ...fields, replay };
                        })
                );
            });
        },
        async compact() {
            return await repair('explicit');
        },
        async clear(request: HistoryClearRequest): Promise<HistoryClearResult> {
            z.literal(true).parse(request.confirmed);
            return await guarded(async function clearHistory() {
                await assertOwnedLocation();
                await assertIdle();
                const paths = [ 'runs', 'history', 'duration-history', 'active-runs' ]
                    .map(function ownedPath(name) {
                        return path.join(directory, name);
                    });
                for (const target of paths) {
                    await rm(target, { recursive: true, force: true });
                }
                return { paths, diagnostics: diagnostics() };
            });
        },
        async prune(request: HistoryPruneRequest): Promise<HistoryPruneResult> {
            return await guarded(async function pruneIdleHistory() {
                await assertOwnedLocation();
                await assertIdle();
                const result = await pruneHistory({ directory, policy, store }, request);
                if (!request.dryRun) {
                    await removeAbandonedOwners();
                }
                return { ...result, diagnostics: diagnostics() };
            });
        }
    };
}
