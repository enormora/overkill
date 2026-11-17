import path from 'node:path';
import type { HistoryPolicy } from '../config/history-policy.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import { emptyCompactHistory, ingestCompactRecord } from './compact-history.ts';
import { compactHistorySchema, type CompactHistory } from './compact-history-schema.ts';
import { historyRecordSchema } from './history-record.ts';
import { historyStateError, assertSupportedHistoryVersion } from './history-state-error.ts';

async function parsedCompactHistory(
    store: Pick<HistoryStorage, 'read'>,
    directory: string
): Promise<CompactHistory | null> {
    const content = await store.read(path.join(directory, 'history', 'index.json'));
    if (content === null) {
        return null;
    }
    assertSupportedHistoryVersion(content, 1);
    return compactHistorySchema.parse(JSON.parse(content));
}

export async function readCompactHistory(
    store: Pick<HistoryStorage, 'read'>,
    directory: string
): Promise<CompactHistory | null> {
    try {
        return await parsedCompactHistory(store, directory);
    } catch (error: unknown) {
        throw historyStateError(error);
    }
}

type HistoryUpdateContext = {
    readonly directory: string;
    readonly policy: HistoryPolicy;
    readonly now: string;
    readonly testFamily: string;
};

export async function updateCompactHistory(
    store: HistoryStorage,
    input: unknown,
    context: HistoryUpdateContext
): Promise<void> {
    const record = historyRecordSchema.parse(input);
    if (record.request.recordForMerge) {
        return;
    }
    const { directory, policy, now, testFamily } = context;
    await store.withLock(async function commitHistory() {
        const current = await readCompactHistory(store, directory) ?? emptyCompactHistory(now);
        const next = ingestCompactRecord(current, record, { policy, now, testFamily });
        await store.write(
            path.join(directory, 'history', 'index.json'),
            `${JSON.stringify(compactHistorySchema.parse(next))}\n`
        );
    });
}

export async function readRequiredCompactHistory(
    store: Pick<HistoryStorage, 'read'>,
    directory: string
): Promise<CompactHistory> {
    const history = await readCompactHistory(store, directory);
    if (history === null) {
        throw historyStateError('Compact history is missing.');
    }
    return history;
}
