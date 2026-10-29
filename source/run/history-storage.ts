import path from 'node:path';
import type { HistoryPolicy } from '../config/history-policy.ts';
import { repairHistory } from './history-repair.ts';
import { recordDurationContributions } from './history-outcomes.ts';
import type { HistoryStorage } from './history-storage-types.ts';
import {
    durationHistoryStateSchema,
    durationStatePath,
    emptyDurationState,
    ingestDurationState,
    readDurationState
} from './duration-history-storage.ts';
import { emptyCompactHistory, ingestCompactRecord } from './compact-history.ts';
import { compactHistorySchema, type CompactHistory } from './compact-history-schema.ts';
import type { HistoryRecord } from './history-record.ts';
import { historyStateError, historySchemaVersion, assertSupportedHistoryVersion } from './history-state-error.ts';

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
    record: HistoryRecord,
    context: HistoryUpdateContext
): Promise<void> {
    const { directory, policy, now, testFamily } = context;
    const source = await store.read(path.join(directory, 'history', 'index.json'));
    if (source !== null && historySchemaVersion(source) === 0) {
        const retained = {
            ...store,
            async list(recordDirectory: string) {
                const files = await store.list(recordDirectory);
                return files.filter(function previousRun(filePath) {
                    return path.basename(filePath) !== `${record.id}.json`;
                });
            }
        };
        await repairHistory(retained, { directory, policy, now, mode: 'automatic' });
    }
    await store.withLock(async function commitHistory() {
        const current = await readCompactHistory(store, directory) ?? emptyCompactHistory(now);
        if (record.status === 'completed') {
            const state = await readDurationState(store, directory, now) ?? emptyDurationState(now);
            const nextDurations = ingestDurationState(state, recordDurationContributions(record), {
                run: { id: record.id, startedAt: record.startedAt },
                source: 'run',
                policy,
                now
            });
            await store.write(
                durationStatePath(directory),
                JSON.stringify(durationHistoryStateSchema.parse(nextDurations))
            );
        }
        const next = ingestCompactRecord(current, record, { policy, now, testFamily });
        await store.write(
            path.join(directory, 'history', 'index.json'),
            `${JSON.stringify(compactHistorySchema.parse(next))}\n`
        );
    });
}
