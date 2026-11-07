import type { RunResult } from '../engine/run-result.ts';
import { finalizeResultWithDurationHistory } from './run-state-finalization.ts';
import type { RecordedCoverageExecution } from './recorded-coverage-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunResultSession } from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun } from './run-types.ts';

export type RunResultSessions = {
    readonly baseline: RunResultSession | null;
    readonly coverageSession: RecordedCoverageExecution['session'] | null;
    readonly record: RecordedCoverageExecution['record'] | null;
};
type RunResultFinalization = RunResultSessions & {
    readonly dependencies: RunOrchestratorDependencies;
    readonly timing: RunTimingMeasurement | null;
};

export async function finalizeRunResult(
    run: ResolvedRun,
    result: RunResult,
    execution: RunResultFinalization
): Promise<RunResult> {
    const { coverageSession, dependencies, record, timing } = execution;
    const prepared = execution.baseline?.prepareResult(result) ?? result;
    const coveredResult = coverageSession === null ? prepared : await coverageSession.finalize(prepared);
    const finalResult = await finalizeResultWithDurationHistory(dependencies, run, coveredResult, timing);
    const recordedResult = record === null ? finalResult : await record.checkpointResult(finalResult);
    return execution.baseline === null ? recordedResult : await execution.baseline.finalize(recordedResult);
}
