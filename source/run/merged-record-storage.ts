import { resolve } from 'node:path';
import { createClock } from '@enormora/clock';
import { createNodeFileStore } from '../file-store.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { serializeRunDiagnostics } from './run-record-result.ts';
import { runRecordPersistenceError } from './run-record-error.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import { updateCompactHistory } from './history-storage.ts';
import { historyRecordSchema } from './history-record.ts';
import type { MergeResultsCommand, MergedRunRecord } from './merge-results-types.ts';

export type MergedRecordStorage = {
    readonly current: () => MergedRunRecord;
    readonly persist: (status: MergedRunRecord['status']) => Promise<void>;
    readonly retainErrors: (errors: readonly RunnerError[]) => void;
    readonly release: () => Promise<void>;
};
export async function createMergedRecordStorage(
    command: MergeResultsCommand,
    initial: MergedRunRecord
): Promise<MergedRecordStorage> {
    const directory = resolve(command.cwd, command.config.runtimeStateDir);
    const file = resolve(directory, 'runs', `${initial.id}.json`);
    const store = createNodeFileStore();
    const history = createNodeHistoryStorage(directory, command.config.history);
    const release = await history.beginRun(initial.id);
    let current = initial;
    function retainErrors(errors: readonly RunnerError[]): void {
        if (errors.length === 0) {
            return;
        }
        const diagnostics = serializeRunDiagnostics({ artifacts: [], perTest: [], runnerErrors: errors });
        current = {
            ...current,
            result: {
                ...current.result,
                status: 'failed',
                runnerErrors: [
                    ...current.result.runnerErrors,
                    ...diagnostics.runnerErrors
                ]
            }
        };
    }
    async function write(): Promise<void> {
        await store.write(file, `${JSON.stringify(current)}\n`);
        const now = new Date(createClock().currentUnixEpochMilliseconds);
        await updateCompactHistory(history, historyRecordSchema.parse(current), {
            directory,
            policy: command.config.history,
            now: now.toISOString(),
            testFamily: current.facts.execution.testFamily
        });
    }
    async function persist(status: MergedRunRecord['status']): Promise<void> {
        current = { ...current, status };
        try {
            await write();
        } catch (error: unknown) {
            const failure = runRecordPersistenceError(file, status === 'completed' ? 'complete' : 'checkpoint', error);
            retainErrors([ failure.runnerError() ]);
            try {
                await store.write(file, `${JSON.stringify(current)}\n`);
            } catch {}
        }
    }
    return {
        current() {
            return current;
        },
        persist,
        retainErrors,
        release
    };
}
