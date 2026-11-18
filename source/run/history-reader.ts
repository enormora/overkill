import { readCompactHistory } from './history-storage.ts';
import { durationIndexProjection } from './duration-history-storage.ts';
import type { DurationHistoryIndex, DurationHistoryStore } from './duration-history-types.ts';

export async function readDurationProjection(
    store: DurationHistoryStore,
    directory: string
): Promise<DurationHistoryIndex | null> {
    const history = await readCompactHistory(store, directory);
    if (history === null) {
        return null;
    }
    const completed = new Set(
        history
            .receipts
            .filter(function committed(receipt) {
                return receipt.state === 'completed';
            })
            .map(function identity(receipt) {
                return receipt.id;
            })
    );
    return durationIndexProjection(history.durations, completed);
}
