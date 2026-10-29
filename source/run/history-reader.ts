import { readCompactHistory } from './history-storage.ts';
import { readDurationState, durationIndexProjection } from './duration-history-storage.ts';
import { historyStateError } from './history-state-error.ts';
import type { DurationHistoryIndex, DurationHistoryStore } from './duration-history-types.ts';

async function completedRuns(store: DurationHistoryStore, directory: string): Promise<ReadonlySet<string>> {
    const history = await readCompactHistory(store, directory);
    if (history === null) {
        throw historyStateError('Compact history is missing.');
    }
    return new Set(
        history
            .receipts
            .filter(function completed(receipt) {
                return receipt.state === 'completed';
            })
            .map(function runIdentity(receipt) {
                return receipt.id;
            })
    );
}

export async function readDurationProjection(
    store: DurationHistoryStore,
    directory: string
): Promise<DurationHistoryIndex | null> {
    const now = new Date();
    const state = await readDurationState(store, directory, now.toISOString());
    if (state === null) {
        return null;
    }
    const hasRecordedObservations = state.entries.some(function recorded(entry) {
        return entry.observations.some(function identified(observation) {
            return observation.runId !== null;
        });
    });
    const completed = hasRecordedObservations ? await completedRuns(store, directory) : new Set<string>();
    return durationIndexProjection(state, completed);
}
