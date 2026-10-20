import { canonicalIdentityJson } from '../canonical-identity.ts';
import { CalibrationPublicationError, type CalibrationReferenceStore } from '../baselines/calibration-store.ts';
import { successfulPerformanceRun } from '../baselines/performance-workflow.ts';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import { performanceBaselineError } from '../baselines/performance-evaluation.ts';
import { calibrationReferenceReportArtifact, type CalibrationReferenceReport } from '../bench/calibration-report.ts';
import type { CalibrationSnapshot } from '../engine/benchmark-result.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunResultSession } from './run-support.ts';

type CaptureSessionInput = {
    readonly store: CalibrationReferenceStore;
    readonly profile: string;
    readonly maxBytes: number;
    readonly dependencies: RunOrchestratorDependencies;
};
function capturedReferences(result: RunResult): readonly CalibrationSnapshot[] {
    const snapshots = new Map<string, CalibrationSnapshot>();
    const candidates = result.perTest.flatMap(function references(test) {
        return test.benchmark?.normalization?.calibrations ?? [];
    });
    for (const snapshot of candidates) {
        const key = canonicalIdentityJson(snapshot.identity);
        if (!snapshots.has(key)) {
            snapshots.set(key, snapshot);
        }
    }
    return Array.from(snapshots.values());
}
function captureReport(
    input: CaptureSessionInput,
    result: RunResult,
    snapshots: readonly CalibrationSnapshot[]
): CalibrationReferenceReport {
    const owners = result.perTest.map(function owner(test) {
        return test.workId;
    });
    return {
        version: 1,
        changes: snapshots.map(function writtenReference(snapshot) {
            return {
                kind: 'write',
                path: input.store.pathOf({ profile: input.profile, snapshot, owners, version: 1 })
            };
        }),
        completed: [],
        outcome: 'read-only'
    };
}
function appendCaptureReport(
    input: CaptureSessionInput,
    result: RunResult,
    report: CalibrationReferenceReport
): RunResult {
    const artifact = calibrationReferenceReportArtifact({
        result,
        report,
        maxBytes: input.maxBytes,
        capturedAtMicroseconds: Number(input.dependencies.wallClock.currentMonotonicMicroseconds)
    });
    return { ...result, artifacts: [ ...result.artifacts, artifact ] };
}
function referenceOwners(result: RunResult, snapshot: CalibrationSnapshot): RunResult['perTest'][number]['workId'][] {
    const key = canonicalIdentityJson(snapshot.identity);
    return result
        .perTest
        .filter(function ownsReference(test) {
            return test.benchmark?.normalization?.calibrations.some(function matchingReference(actual) {
                return canonicalIdentityJson(actual.identity) === key;
            }) ?? false;
        })
        .map(function work(test) {
            return test.workId;
        });
}
async function publishCapture(
    input: CaptureSessionInput,
    result: RunResult,
    report: CalibrationReferenceReport,
    snapshots: readonly CalibrationSnapshot[]
): Promise<RunResult> {
    appendCaptureReport(input, result, report);
    const completed = snapshots.length === 0
        ? []
        : await input.store.write(input.profile, snapshots, function owners(snapshot) {
            return referenceOwners(result, snapshot);
        });
    return appendCaptureReport(input, result, { ...report, completed, outcome: 'written' });
}
async function completeCapture(
    input: CaptureSessionInput,
    result: RunResult,
    report: CalibrationReferenceReport,
    snapshots: readonly CalibrationSnapshot[]
): Promise<RunResult> {
    return successfulPerformanceRun(result)
        ? await publishCapture(input, result, report, snapshots)
        : appendCaptureReport(input, result, { ...report, outcome: 'blocked' });
}
async function finalizeCapture(input: CaptureSessionInput, result: RunResult): Promise<RunResult> {
    const snapshots = capturedReferences(result);
    const report = captureReport(input, result, snapshots);
    try {
        return await completeCapture(input, result, report, snapshots);
    } catch (error: unknown) {
        const failed = appendRunnerErrors(result, [ performanceBaselineError(error, null) ]);
        const completed = error instanceof CalibrationPublicationError ? error.completed() : [];
        try {
            return appendCaptureReport(input, failed, { ...report, completed, outcome: 'failed' });
        } catch {
            return failed;
        }
    }
}
export function createCalibrationCaptureSession(input: CaptureSessionInput): RunResultSession {
    return {
        reporterDispatcher: input.dependencies.reporterDispatcher,
        async finalize(result) {
            return await finalizeCapture(input, result);
        }
    };
}
