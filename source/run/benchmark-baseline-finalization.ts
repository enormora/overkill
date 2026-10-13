import type { Except } from 'type-fest';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import type { BaselineChange, BaselineUpdateMode, BaselineWriteOutcome } from '../baselines/performance-baseline.ts';
import { successfulPerformanceRun, type PerformanceWorkflow } from '../baselines/performance-workflow.ts';
import { performanceBaselineError } from '../baselines/performance-evaluation.ts';
import { performanceReportArtifact, type PerformanceBaselineReport } from '../baselines/performance-report.ts';
import type { PerformanceBaselineEvidence } from '../baselines/performance-presentation.ts';
import type { ComparableCalibration } from '../packages/run/benchmark-calibration.entry-point.ts';

type BaselineFinalizationInput = {
    readonly calibration: ComparableCalibration;
    readonly capturedAtMicroseconds: () => number;
    readonly completeInventory: boolean;
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
    readonly notify: (errors: readonly RunnerError[]) => Promise<readonly RunnerError[]>;
    readonly result: RunResult;
    readonly workflow: PerformanceWorkflow;
    readonly comparisons: readonly PerformanceBaselineEvidence[];
};
type BaselineCommit = {
    readonly errors: readonly RunnerError[];
    readonly outcome: BaselineWriteOutcome;
};

function reportFor(input: BaselineFinalizationInput, writeOutcome: BaselineWriteOutcome): PerformanceBaselineReport {
    return {
        version: 2,
        comparisons: input.comparisons,
        calibration: input.calibration,
        changes: input.workflow.changes,
        writeOutcome
    };
}

async function commitChanges(
    input: BaselineFinalizationInput,
    written: readonly BaselineChange[],
    recordWritten: (change: BaselineChange) => void
): Promise<BaselineWriteOutcome> {
    performanceReportArtifact({
        capturedAtMicroseconds: 0,
        maxBytes: input.maxBytes,
        report: reportFor(input, { changes: input.workflow.changes, kind: 'written' }),
        result: input.result
    });
    if (input.mode === 'none' || input.mode === 'diff') {
        return { kind: 'read-only' };
    }
    if (!successfulPerformanceRun(input.result)) {
        return { kind: 'blocked' };
    }
    for (const change of input.workflow.changes) {
        await input.workflow.store.apply(change);
        recordWritten(change);
    }
    return { changes: written, kind: 'written' };
}

async function commitBaselines(input: BaselineFinalizationInput): Promise<BaselineCommit> {
    const written: BaselineChange[] = [];
    try {
        return {
            errors: [],
            outcome: await commitChanges(input, written, function recordWritten(change) {
                written.push(change);
            })
        };
    } catch (error: unknown) {
        return {
            errors: [ performanceBaselineError(error, null) ],
            outcome: { kind: 'failed', writtenChanges: written }
        };
    }
}

function attachCoreReport(input: BaselineFinalizationInput, outcome: BaselineWriteOutcome): RunResult {
    try {
        const artifact = performanceReportArtifact({
            capturedAtMicroseconds: input.capturedAtMicroseconds(),
            maxBytes: input.maxBytes,
            report: reportFor(input, outcome),
            result: input.result
        });
        return { ...input.result, artifacts: [ ...input.result.artifacts, artifact ] };
    } catch {
        return input.result;
    }
}

async function attachReport(input: BaselineFinalizationInput, outcome: BaselineWriteOutcome): Promise<RunResult> {
    try {
        const artifact = performanceReportArtifact({
            capturedAtMicroseconds: input.capturedAtMicroseconds(),
            maxBytes: input.maxBytes,
            report: reportFor(input, outcome),
            result: input.result
        });
        return { ...input.result, artifacts: [ ...input.result.artifacts, artifact ] };
    } catch (error: unknown) {
        const failure = performanceBaselineError(error, null);
        const failed = appendRunnerErrors(input.result, [ failure, ...await input.notify([ failure ]) ]);
        return attachCoreReport({ ...input, comparisons: [], result: failed }, outcome);
    }
}

export async function finalizeBenchmarkBaselines(
    input: Except<BaselineFinalizationInput, 'comparisons'>
): Promise<RunResult> {
    const completion = input.workflow.finish(input.result, input.completeInventory);
    const result = appendRunnerErrors(completion.result, completion.errors);
    const committed = await commitBaselines({ ...input, comparisons: [], result });
    const presentation = input.workflow.present();
    const finalized = appendRunnerErrors(result, [ ...committed.errors, ...presentation.errors ]);
    const reportingErrors = await input.notify([ ...completion.errors, ...committed.errors, ...presentation.errors ]);
    return await attachReport({
        ...input,
        comparisons: presentation.comparisons,
        result: appendRunnerErrors(finalized, reportingErrors)
    }, committed.outcome);
}
