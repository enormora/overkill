import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { runRecordPersistenceError, type RunRecordError, type RunRecordPhase } from './run-record-error.ts';
import { recordedRunResult } from './run-record-result.ts';
import type { RunRecord } from './run-record-types.ts';

export type RunRecordStorage = {
    readonly current: () => RunRecord;
    readonly persist: (value: RunRecord, phase: RunRecordPhase) => Promise<void>;
    readonly result: (result: RunResult, status: 'completed' | 'started') => Promise<RunResult>;
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
    initial: RunRecord,
    store: Pick<RunOrchestratorDependencies['runtimeStateStore'], 'write'>
): RunRecordStorage {
    let current = initial;
    const storage: RunRecordStorage = {
        current() {
            return current;
        },
        async persist(value, phase) {
            current = value;
            try {
                await store.write(filePath, `${JSON.stringify(value, null, jsonIndentation)}\n`);
            } catch (error: unknown) {
                throw runRecordPersistenceError(filePath, phase, error);
            }
        },
        async result(result, status) {
            const phase = status === 'completed' ? 'complete' : 'checkpoint';

            try {
                await storage.persist({ ...current, result: recordedRunResult(result), status }, phase);
                return result;
            } catch (error: unknown) {
                const persistenceError = runRecordPersistenceError(filePath, phase, error);
                const failure = resultWithPersistenceError(result, persistenceError, phase);
                await preserveFailure(storage, failure, status);
                return failure;
            }
        }
    };

    return storage;
}
