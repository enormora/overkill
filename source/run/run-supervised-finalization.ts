import type { RunResult } from '../engine/run-result.ts';
import type { RecordedCoverageExecution } from './recorded-coverage-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { finalizeResultWithDurationHistory } from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun } from './run-types.ts';

export type SupervisedCoverageExecution = {
    readonly coverageSession: RecordedCoverageExecution['session'] | null;
    readonly record: RecordedCoverageExecution['record'] | null;
};
type SupervisedFinalization = SupervisedCoverageExecution & {
    readonly dependencies: RunOrchestratorDependencies;
    readonly timing: RunTimingMeasurement | null;
};

export async function finalizeSupervisedResult(
    run: ResolvedRun,
    result: RunResult,
    execution: SupervisedFinalization
): Promise<RunResult> {
    const { coverageSession, dependencies, record, timing } = execution;
    const coveredResult = coverageSession === null ? result : await coverageSession.finalize(result);
    const finalResult = await finalizeResultWithDurationHistory(dependencies, run, coveredResult, timing);
    return record === null ? finalResult : await record.checkpointResult(finalResult);
}
