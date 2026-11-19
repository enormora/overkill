import path from 'node:path';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { profileFamilyId } from '../config/types.ts';
import type { RunResult } from '../engine/run-result.ts';
import { recordedRunPlan } from './recorded-run-plan.ts';
import { updateCompactHistory } from './history-storage.ts';
import { createRunRecordStorage } from './run-record-storage.ts';
import type { SingleRunRecord, RunRecordCoverage } from './run-record-types.ts';
import { initialRecord, type RunRecordDependencies, type RunRecordInput } from './run-record-input.ts';
import type { RunFacts, RunnerResult, CollectedRunPlan, ResolvedRun } from './run-types.ts';

export type RunRecordSession = {
    readonly requireDetails: () => void;
    readonly complete: (result: RunResult) => Promise<RunnerResult>;
    readonly checkpointResult: (result: RunResult) => Promise<RunResult>;
    readonly id: string;
    readonly startedAt: string;
    readonly interrupt: (error: unknown) => Promise<void>;
    readonly path: string;
    readonly retainPlacementTrace: (trace: SingleRunRecord['placementTrace']) => void;
    readonly recordResolvedRun: (run: ResolvedRun) => Promise<void>;
    readonly recordFacts: (facts: RunFacts, replayPlan: CollectedRunPlan | null) => Promise<void>;
    readonly start: (coverage: RunRecordCoverage | null) => Promise<void>;
};

export function createRunRecordSession(
    cwd: string,
    input: RunRecordInput,
    dependencies: RunRecordDependencies
): RunRecordSession {
    const value = initialRecord(cwd, input, dependencies);
    const filePath = path.resolve(input.projectRoot, input.config.runtimeStateDir, 'runs', `${value.id}.json`);
    const directory = path.dirname(path.dirname(filePath));
    const storage = createRunRecordStorage(filePath, value, {
        detail: dependencies.detail,
        async write(recordPath, content) {
            await dependencies.store.write(recordPath, content);
        },
        async committed(record) {
            const now = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);
            await updateCompactHistory(dependencies.history, record, {
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
            await withRunnerInfrastructure(async function releaseRecordedOwner() {
                await release?.();
            });
        }
    }
    const session: RunRecordSession = {
        requireDetails: storage.requireDetails,
        async recordResolvedRun(run) {
            await session.recordFacts(run.facts, recordedRunPlan(run));
        },
        async checkpointResult(result) {
            return await storage.result(result, 'started', { placementTrace });
        },
        async complete(result) {
            const completed = await completeRecord(result);
            if (value.request.recordForMerge) {
                return {
                    ...completed,
                    context: {
                        id: value.id,
                        startedAt: value.startedAt,
                        facts: storage.current().facts ?? completed.preparationFacts
                    },
                    maintenanceDiagnostics: []
                };
            }
            maintenance = maintenance ?? withRunnerInfrastructure(dependencies.maintainHistory);
            return {
                ...completed,
                context: {
                    id: value.id,
                    startedAt: value.startedAt,
                    facts: storage.current().facts ?? completed.preparationFacts
                },
                maintenanceDiagnostics: await maintenance
            };
        },
        id: value.id,
        startedAt: value.startedAt,
        async interrupt(error) {
            try {
                await storage.interrupt(error, placementTrace);
            } finally {
                const release = releaseOwner;
                releaseOwner = null;
                await withRunnerInfrastructure(async function releaseInterruptedOwner() {
                    await release?.();
                });
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
            releaseOwner = await withRunnerInfrastructure(async function beginRecordedRun() {
                return await dependencies.history.beginRun(value.id);
            });
            try {
                await storage.persist({ ...storage.current(), coverage }, 'start');
            } catch (error: unknown) {
                const release = releaseOwner;
                releaseOwner = null;
                await withRunnerInfrastructure(release);
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
