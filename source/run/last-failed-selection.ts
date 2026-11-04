import { createHistoryAccess } from './history-state-access.ts';
import { repairHistory } from './history-repair.ts';
import { retainCompactHistory } from './compact-history.ts';
import { readRequiredCompactHistory } from './history-reader.ts';
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
    const { directory, store, guarded, policy } = access;
    const timestamp = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);
    const now = timestamp.toISOString();
    const index = await readRequiredCompactHistory(store, directory, async function repairAutomatically() {
        return await repairHistory({
            ...store,
            async withLock(operation) {
                return await guarded(async function repairIdleHistory() {
                    await access.assertOwnedLocation();
                    await access.assertIdle();
                    return await operation();
                });
            }
        }, { directory, policy, now, mode: 'automatic' });
    });
    const retained = retainCompactHistory(index, options.config.history, now);
    const failedCases = retained
        .cases
        .filter(function lastOutcomeFailed(entry) {
            return entry.observations[0]?.status === 'failed';
        })
        .map(function identity(entry) {
            return entry.identity;
        });
    return resolveLastFailedSelection(selection, failedCases);
}
