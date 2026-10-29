import path from 'node:path';
import type { RunResult } from '../engine/run-result.ts';
import { updateCompactHistory } from './history-storage.ts';
import { createRunRecordStorage } from './run-record-storage.ts';
import type { RunRecord, RunRecordCoverage } from './run-record-types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { initialRecord, type RunRecordDependencies } from './run-record-input.ts';
import type { RunFacts } from './run-types.ts';

export type RunRecordSession = {
    readonly complete: (result: RunResult) => Promise<RunResult>;
    readonly checkpointResult: (result: RunResult) => Promise<RunResult>;
    readonly id: string;
    readonly interrupt: (error: unknown) => Promise<void>;
    readonly path: string;
    readonly retainPlacementTrace: (trace: RunRecord['placementTrace']) => void;
    readonly recordFacts: (facts: RunFacts) => Promise<void>;
    readonly start: (coverage: RunRecordCoverage | null) => Promise<void>;
};

export function createRunRecordSession(
    cwd: string,
    input: Pick<ResolvedRunInput, 'config' | 'engine' | 'profile' | 'projectRoot' | 'request'>,
    dependencies: RunRecordDependencies
): RunRecordSession {
    const value = initialRecord(cwd, input, dependencies);
    const filePath = path.resolve(input.projectRoot, input.config.runtimeStateDir, 'runs', `${value.id}.json`);
    const directory = path.dirname(path.dirname(filePath));
    const storage = createRunRecordStorage(filePath, value, {
        async write(recordPath, content) {
            await dependencies.store.write(recordPath, content);
            const now = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);
            await updateCompactHistory(dependencies.history, storage.current(), {
                directory,
                policy: input.config.history,
                now: now.toISOString(),
                testFamily: input.profile.testFamily
            });
        }
    });

    let placementTrace: RunRecord['placementTrace'] = null;
    return {
        async checkpointResult(result) {
            return await storage.result(result, 'started', { placementTrace });
        },
        async complete(result) {
            return await storage.result(result, 'completed', { placementTrace });
        },
        id: value.id,
        async interrupt(error) {
            await storage.interrupt(error, placementTrace);
        },
        path: filePath,
        retainPlacementTrace(trace) {
            placementTrace = trace;
        },
        async recordFacts(facts) {
            await storage.persist({
                ...storage.current(),
                facts,
                identities: facts.cases.map(function workIdentity(test) {
                    return test.workId;
                })
            }, 'facts');
        },
        async start(coverage) {
            await storage.persist({ ...storage.current(), coverage }, 'start');
        }
    };
}

export async function interruptRunRecord(record: RunRecordSession, error: unknown): Promise<never> {
    try {
        await record.interrupt(error);
    } catch (recordError: unknown) {
        throw new AggregateError([ error, recordError ], 'Execution and run record persistence failed.', {
            cause: recordError
        });
    }
    throw error;
}
