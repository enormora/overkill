import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RunResult } from '../engine/run-result.ts';
import { performanceBaselineError } from '../baselines/performance-evaluation.ts';
import { successfulPerformanceRun } from '../baselines/performance-workflow.ts';
import {
    CalibrationPublicationError,
    type CalibrationReferenceStore
} from '../baselines/calibration-store.ts';
import { calibrationReferenceReportArtifact, type CalibrationReferenceReport } from '../bench/calibration-report.ts';
import { staleCalibrationReferences, type CalibrationInventory } from './calibration-inventory.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunResultSession } from './run-support.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type MaintenanceInput = {
    readonly input: ResolvedRunInput;
    readonly references: CalibrationInventory;
    readonly store: CalibrationReferenceStore;
    readonly baseline: RunResultSession | null;
    readonly dependencies: Pick<RunOrchestratorDependencies, 'reporterDispatcher' | 'wallClock'>;
};
function completeInventory(input: ResolvedRunInput): boolean {
    return input.request.paths.length === 0 && input.request.selection.kind === 'all' &&
        input.request.shard.total === 1;
}
function appendReport(session: MaintenanceInput, result: RunResult, report: CalibrationReferenceReport): RunResult {
    const { profile } = session.input;
    if (profile.testFamily !== 'benchmark') {
        throw new TypeError('Calibration maintenance requires a benchmark profile.');
    }
    const artifact = calibrationReferenceReportArtifact({
        result,
        report,
        maxBytes: profile.attachments.maxArtifactBytes,
        capturedAtMicroseconds: Number(session.dependencies.wallClock.currentMonotonicMicroseconds)
    });
    return { ...result, artifacts: [ ...result.artifacts, artifact ] };
}
async function publishRemovals(
    session: MaintenanceInput,
    result: RunResult,
    stale: CalibrationInventory,
    report: CalibrationReferenceReport
): Promise<RunResult> {
    appendReport(session, result, report);
    const completed = session.input.request.baselineUpdateMode === 'apply' && successfulPerformanceRun(result)
        ? await session.store.remove(stale)
        : [];
    return appendReport(session, result, {
        ...report,
        completed,
        outcome: completed.length > 0 ? 'written' : 'read-only'
    });
}
async function retainMaintenance(
    session: MaintenanceInput,
    result: RunResult,
    stale: CalibrationInventory
): Promise<RunResult> {
    const report: CalibrationReferenceReport = {
        version: 1,
        completed: [],
        outcome: 'read-only',
        changes: stale.map(function removal(reference) {
            return { kind: 'remove', path: session.store.pathOf(reference) };
        })
    };
    try {
        return await publishRemovals(session, result, stale, report);
    } catch (error: unknown) {
        const failed = appendRunnerErrors(result, [ performanceBaselineError(error, null) ]);
        const completed = error instanceof CalibrationPublicationError ? error.completed() : [];
        try {
            return appendReport(session, failed, { ...report, completed, outcome: 'failed' });
        } catch {
            return failed;
        }
    }
}
function checkedResult(session: MaintenanceInput, result: RunResult, stale: CalibrationInventory): RunResult {
    const mode = session.input.request.baselineUpdateMode;
    return stale.length > 0 && mode !== 'apply' && mode !== 'diff'
        ? appendRunnerErrors(result, [ performanceBaselineError(
            new Error('Stale calibration references require overkill bench baseline apply.'),
            null
        ) ])
        : result;
}
async function finalizeMaintenance(session: MaintenanceInput, result: RunResult): Promise<RunResult> {
    const stale = successfulPerformanceRun(result)
        ? staleCalibrationReferences({
            profile: session.input.request.profile,
            machineClass: session.input.benchmarkNormalization?.machine.machineClass ?? null,
            references: session.references,
            result
        })
        : [];
    const checked = checkedResult(session, result, stale);
    const finalized = session.baseline === null ? checked : await session.baseline.finalize(checked);
    return stale.length === 0 ? finalized : await retainMaintenance(session, finalized, stale);
}
export function calibrationMaintenanceSession(session: MaintenanceInput): RunResultSession | null {
    if (session.references.length === 0 || !completeInventory(session.input)) {
        return session.baseline;
    }
    return {
        reporterDispatcher: session.baseline?.reporterDispatcher ?? session.dependencies.reporterDispatcher,
        async finalize(result) {
            return await finalizeMaintenance(session, result);
        }
    };
}
