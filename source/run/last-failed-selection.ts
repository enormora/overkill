import { createHistoryAccess } from './history-state-access.ts';
import { retainCompactHistory } from './compact-history.ts';
import { readRequiredCompactHistory } from './history-storage.ts';
import type { HistoryOptions } from './history-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunSelection } from './run-types.ts';
import { resolveLastFailedSelection } from './run-selection.ts';

export async function readLastFailedSelection(
    selection: RunSelection,
    options: HistoryOptions,
    dependencies: Pick<RunOrchestratorDependencies, 'createHistoryStorage' | 'wallClock'>
): Promise<RunSelection> {
    const access = createHistoryAccess(options, dependencies.createHistoryStorage);
    const { directory, store } = access;
    const timestamp = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);
    const now = timestamp.toISOString();
    const index = await readRequiredCompactHistory(store, directory);
    const retained = retainCompactHistory(index, options.config.history, now);
    const failedCases = retained
        .cases
        .filter(function lastOutcomeFailed(entry) {
            return entry.observations[0]?.status === 'failed';
        })
        .map(function identity(entry) {
            return entry.identity;
        });
    const completed = new Set(
        retained
            .receipts
            .filter(function committed(receipt) {
                return receipt.state === 'completed';
            })
            .map(function runId(receipt) {
                return receipt.id;
            })
    );
    const failedWork = retained
        .durations
        .entries
        .filter(function lastOutcomeFailed(entry) {
            return entry
                .familyVerdicts
                .find(function committed(verdict) {
                    return completed.has(verdict.runId);
                })
                ?.status === 'failed';
        })
        .map(function identity(entry) {
            return entry.work;
        });
    return resolveLastFailedSelection(selection, failedCases, failedWork);
}
