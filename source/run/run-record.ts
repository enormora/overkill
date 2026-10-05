import path from 'node:path';
import type { RunResult } from '../engine/run-result.ts';
import { createResultFromResolutionError } from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunRecordStorage } from './run-record-storage.ts';
import { recordedRunResult } from './run-record-result.ts';
import type { RunRecordCoverage } from './run-record-types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { initialRecord, type RunRecordDependencies } from './run-record-input.ts';
import type { RunFacts } from './run-types.ts';

export type RunRecordSession = {
    readonly complete: (result: RunResult) => Promise<RunResult>;
    readonly checkpointResult: (result: RunResult) => Promise<RunResult>;
    readonly id: string;
    readonly interrupt: (error: unknown) => Promise<void>;
    readonly path: string;
    readonly recordFacts: (facts: RunFacts) => Promise<void>;
    readonly start: (coverage: RunRecordCoverage | null) => Promise<void>;
};

export function createRunRecordSession(
    cwd: string,
    input: ResolvedRunInput,
    dependencies: RunRecordDependencies
): RunRecordSession {
    const value = initialRecord(cwd, input, dependencies);
    const filePath = path.resolve(input.projectRoot, input.config.runtimeStateDir, 'runs', `${value.id}.json`);
    const storage = createRunRecordStorage(filePath, value, dependencies.store);

    return {
        async checkpointResult(result) {
            return await storage.result(result, 'started');
        },
        async complete(result) {
            return await storage.result(result, 'completed');
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
                status: 'interrupted'
            }, 'interrupt');
        },
        path: filePath,
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
