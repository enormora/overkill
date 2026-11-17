import { resolve } from 'node:path';
import { createClock } from '@enormora/clock';
import { createNodeFileStore } from '../file-store.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { openMergedRecordStorage, type MergedRecordStorage } from './merged-record-storage.ts';
import type { MergeResultsCommand, MergedRunRecord } from './merge-results-types.ts';

export async function createMergedRecordStorage(
    command: MergeResultsCommand,
    initial: MergedRunRecord
): Promise<MergedRecordStorage> {
    return await openMergedRecordStorage(command, initial, {
        files: createNodeFileStore(),
        history: createNodeHistoryStorage(resolve(command.cwd, command.config.runtimeStateDir), command.config.history),
        now() {
            const now = new Date(createClock().currentUnixEpochMilliseconds);
            return now.toISOString();
        }
    });
}
