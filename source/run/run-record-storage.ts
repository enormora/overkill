import { join, dirname } from 'node:path';
import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createDebugArtifactStore, persistDebugResult } from './debug-artifact-storage.ts';
import { compactRunRecord } from './compact-run-record.ts';
import {
    interruptedRunResult,
    runRecordPersistenceError,
    type RunRecordError,
    type RunRecordPhase
} from './run-record-error.ts';
import { recordedRunResult } from './run-record-result.ts';
import type { SingleRunRecord, CompactRunRecord } from './run-record-types.ts';

export type RunRecordStorage = {
    readonly requireDetails: () => void;
    readonly interrupt: (error: unknown, placementTrace: SingleRunRecord['placementTrace']) => Promise<void>;
    readonly current: () => SingleRunRecord;
    readonly persist: (value: SingleRunRecord, phase: RunRecordPhase) => Promise<void>;
    readonly result: (
        result: RunResult,
        status: 'completed' | 'started',
        metadata: Pick<SingleRunRecord, 'placementTrace'>
    ) => Promise<RunResult>;
};

const jsonIndentation = 2;

async function preserveFailure(
    storage: RunRecordStorage,
    result: RunResult,
    status: 'completed' | 'started'
): Promise<void> {
    const phase = status === 'completed' ? 'complete' : 'checkpoint';
    try {
        await storage.persist(
            { ...storage.current(), result: recordedRunResult(result), status },
            phase
        );
    } catch {
    }
}

function resultWithPersistenceError(result: RunResult, error: RunRecordError, phase: RunRecordPhase): RunResult {
    const runnerError = error.runnerError();
    if (phase === 'complete') {
        recordUndeliveredRunnerError(runnerError);
    }
    return { ...result, runnerErrors: [ ...result.runnerErrors, runnerError ], status: 'failed' };
}

type RecordStorageInput = Parameters<typeof createDebugArtifactStore>[1] & {
    readonly detail: 'compact' | 'detailed';
    readonly committed: (record: CompactRunRecord | SingleRunRecord) => Promise<void>;
};

export function createRunRecordStorage(
    filePath: string,
    initial: SingleRunRecord,
    store: RecordStorageInput
): RunRecordStorage {
    let current = initial;
    let { detail } = store;
    const debugArtifacts = createDebugArtifactStore(join(dirname(filePath), initial.id, 'debug'), store);
    const storage: RunRecordStorage = {
        requireDetails() {
            detail = 'detailed';
        },
        async interrupt(error, placementTrace) {
            const result = recordedRunResult(interruptedRunResult(error));
            const previousResult = current.result;
            const interruptedResult = previousResult === null ? result : {
                ...previousResult,
                runnerErrors: [ ...previousResult.runnerErrors, ...result.runnerErrors ],
                status: 'failed' as const
            };
            await storage.persist(
                { ...current, result: interruptedResult, placementTrace, status: 'interrupted' },
                'interrupt'
            );
        },
        current() {
            return current;
        },
        async persist(value, phase) {
            current = value;
            try {
                await withRunnerInfrastructure(async function writeRunRecord() {
                    const stored = detail === 'compact' ? compactRunRecord(value) : value;
                    await store.write(filePath, `${JSON.stringify(stored, null, jsonIndentation)}\n`);
                    await store.committed(stored);
                });
            } catch (error: unknown) {
                throw runRecordPersistenceError(filePath, phase, error);
            }
        },
        async result(result, status, metadata) {
            const phase = status === 'completed' ? 'complete' : 'checkpoint';
            const persistedResult = await persistDebugResult(result, debugArtifacts, status === 'completed');
            try {
                await storage.persist(
                    { ...current, ...metadata, result: recordedRunResult(persistedResult), status },
                    phase
                );
                return persistedResult;
            } catch (error: unknown) {
                const persistenceError = runRecordPersistenceError(filePath, phase, error);
                const failure = resultWithPersistenceError(persistedResult, persistenceError, phase);
                await preserveFailure(storage, failure, status);
                return failure;
            }
        }
    };

    return storage;
}
