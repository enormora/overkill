import path from 'node:path';
import { profileFamilyId } from '../config/types.ts';
import type { RunResult } from '../engine/run-result.ts';
import { recordedRunPlan } from './recorded-run-plan.ts';
import { updateCompactHistory } from './history-storage.ts';
import { createRunRecordStorage } from './run-record-storage.ts';
import type { SingleRunRecord, RunRecordCoverage } from './run-record-types.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { initialRecord, type RunRecordDependencies } from './run-record-input.ts';
import type { RunFacts, RunnerResult, CollectedRunPlan, ResolvedRun } from './run-types.ts';

export type RunRecordSession = {
    readonly complete: (result: RunResult) => Promise<RunnerResult>;
    readonly checkpointResult: (result: RunResult) => Promise<RunResult>;
    readonly id: string;
    readonly interrupt: (error: unknown) => Promise<void>;
    readonly path: string;
    readonly retainPlacementTrace: (trace: SingleRunRecord['placementTrace']) => void;
    readonly recordResolvedRun: (run: ResolvedRun) => Promise<void>;
    readonly recordFacts: (facts: RunFacts, replayPlan: CollectedRunPlan | null) => Promise<void>;
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
            await updateCompactHistory(dependencies.history, {
                replayPlan: null,
                replayProfile: null,
                ...storage.current()
            }, {
                directory,
                policy: input.config.history,
                now: now.toISOString(),
                testFamily: profileFamilyId(input.profile)
            });
        }
    });

    let releaseOwner: (() => Promise<void>) | null = null;
    let placementTrace: SingleRunRecord['placementTrace'] = null;
    let maintenance: Promise<readonly string[]> | null = null;
    async function completeRecord(result: RunResult): Promise<RunResult> {
        try {
            return await storage.result(result, 'completed', { placementTrace });
        } finally {
            const release = releaseOwner;
            releaseOwner = null;
            await release?.();
        }
    }
    const session: RunRecordSession = {
        async recordResolvedRun(run) {
            await session.recordFacts(run.facts, recordedRunPlan(run));
        },
        async checkpointResult(result) {
            return await storage.result(result, 'started', { placementTrace });
        },
        async complete(result) {
            const completed = await completeRecord(result);
            if (value.request.recordForMerge) {
                return { ...completed, maintenanceDiagnostics: [] };
            }
            maintenance = maintenance ?? dependencies.maintainHistory();
            return {
                ...completed,
                maintenanceDiagnostics: await maintenance
            };
        },
        id: value.id,
        async interrupt(error) {
            try {
                await storage.interrupt(error, placementTrace);
            } finally {
                const release = releaseOwner;
                releaseOwner = null;
                await release?.();
            }
        },
        path: filePath,
        retainPlacementTrace(trace) {
            placementTrace = trace;
        },
        async recordFacts(facts, replayPlan) {
            await storage.persist({
                ...storage.current(),
                version: value.version,
                replayPlan,
                replayWitness: value.replayWitness,
                replayProfile: value.replayProfile,
                facts,
                identities: facts.cases.map(function workIdentity(test) {
                    return test.workId;
                })
            }, 'facts');
        },
        async start(coverage) {
            releaseOwner = await dependencies.history.beginRun(value.id);
            try {
                await storage.persist({ ...storage.current(), coverage }, 'start');
            } catch (error: unknown) {
                const release = releaseOwner;
                releaseOwner = null;
                await release();
                throw error;
            }
        }
    };
    return session;
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
