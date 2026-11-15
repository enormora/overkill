import { join, dirname } from 'node:path';
import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import { withRunnerInfrastructure } from '../engine/execution-observation.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createDebugArtifactStore, persistDebugResult } from './debug-artifact-storage.ts';
import { createResultFromResolutionError } from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { runRecordPersistenceError, type RunRecordError, type RunRecordPhase } from './run-record-error.ts';
import { recordedRunResult } from './run-record-result.ts';
import type { SingleRunRecord } from './run-record-types.ts';

export type RunRecordStorage = {
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

export function createRunRecordStorage(
    filePath: string,
    initial: SingleRunRecord,
    store: Parameters<typeof createDebugArtifactStore>[1]
): RunRecordStorage {
    let current = initial;
    const debugArtifacts = createDebugArtifactStore(join(dirname(filePath), initial.id, 'debug'), store);
    const storage: RunRecordStorage = {
        async interrupt(error, placementTrace) {
            const crash = new RunCollectionError('Run interrupted before completion.', { cause: error }, 'crash');
            const result = recordedRunResult(createResultFromResolutionError(crash, null));
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
                    await store.write(filePath, `${JSON.stringify(value, null, jsonIndentation)}\n`);
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
