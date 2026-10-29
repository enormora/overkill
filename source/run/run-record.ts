import path from 'node:path';
import type { RunResult } from '../engine/run-result.ts';
import { createResultFromResolutionError } from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunRecordStorage } from './run-record-storage.ts';
import { recordedRunResult } from './run-record-result.ts';
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
    const storage = createRunRecordStorage(filePath, value, dependencies.store);

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
            const result = recordedRunResult(createResultFromResolutionError(
                new RunCollectionError('Run interrupted before completion.', { cause: error }, 'crash'),
                null
            ));
            const previousResult = storage.current().result;
            const interruptedResult = previousResult === null ? result : {
                ...previousResult,
                runnerErrors: [ ...previousResult.runnerErrors, ...result.runnerErrors ],
                status: 'failed' as const
            };
            await storage.persist({
                ...storage.current(),
                result: interruptedResult,
                placementTrace,
                status: 'interrupted'
            }, 'interrupt');
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
