import { formatCaseId, type CaseId } from '../engine/identity.ts';
import type { OutputLineIntent } from '../engine/reporter-output.ts';
import { formatSourceLocation, type ReportingContext } from '../engine/reporting-context.ts';
import type { RunResult, RunnerError, TestFailure } from '../engine/run-result.ts';
import { primaryFailureSourceLocation } from './failure-location.ts';
import { formatFailureSummary, formatPropertyDiagnostics } from './failure-summary.ts';
import { witnessReplayLines } from './witness-replay-lines.ts';
import { formatCoverageSummaryLines, formatTimingOffenderLines, formatTimingSummary } from './run-summary-rendering.ts';

const microsecondsPerMillisecond = 1000;

export type BriefReporterSinks = readonly [{ readonly kind: 'stdout-managed-primary'; }];

export const briefReporterSinks: BriefReporterSinks = [ { kind: 'stdout-managed-primary' } ];

export function stdout(text: string, annotation: OutputLineIntent['annotation']): OutputLineIntent {
    return {
        annotation,
        kind: 'stdout-line',
        role: 'primary',
        text
    };
}

function formatFailureLine(
    id: CaseId,
    failure: TestFailure,
    context: ReportingContext
): string {
    const location = primaryFailureSourceLocation(failure);
    const locationText = location === null ? null : formatSourceLocation(location, context);
    const origin = locationText === null ? formatCaseId(id) : `${locationText} ${formatCaseId(id)}`;

    return `fail ${origin}: ${formatFailureSummary(failure)}`;
}

export function failureIntent(
    id: CaseId,
    failure: TestFailure,
    context: ReportingContext
): OutputLineIntent {
    const location = primaryFailureSourceLocation(failure);

    return stdout(formatFailureLine(id, failure, context), {
        location,
        severity: 'error',
        title: formatCaseId(id)
    });
}

function executedCount(result: RunResult): number {
    const { summary } = result;

    return summary.passed + summary.failed + summary.skipped + summary.inconclusive +
        summary.processExhausted + summary.crashed;
}

function retryCountSummary(result: RunResult): string {
    const count = result
        .perTest
        .filter(function retried(testResult) {
            return testResult.retried !== null;
        })
        .length;
    return count === 0 ? '' : `retried=${count} `;
}

function finishIntent(result: RunResult): OutputLineIntent {
    const { summary } = result;
    const discoveryCounts = `done status=${result.status} discovered=${summary.discovered} planned=${summary.planned}`;
    const executionCounts = `executed=${executedCount(result)} passed=${summary.passed} failed=${summary.failed}`;
    const totalMicroseconds = result.timings.summary.totalWallTimeMicroseconds;
    const remainingCounts = `skipped=${summary.skipped} inconclusive=${summary.inconclusive} ` +
        `processExhausted=${summary.processExhausted} runtimePolicy=${summary.runtimePolicy} ` +
        `crashed=${summary.crashed} ` +
        `ms=${totalMicroseconds / microsecondsPerMillisecond}`;

    return stdout(
        `${discoveryCounts} ${executionCounts} ${retryCountSummary(result)}${remainingCounts} timing="${
            formatTimingSummary(result)
        }"`,
        null
    );
}

export function runnerErrorIntent(error: RunnerError): OutputLineIntent {
    return stdout(`runner-error ${error.message}`, {
        location: null,
        severity: 'error',
        title: 'Runner error'
    });
}

function propertyDiagnosticIntents(result: RunResult): readonly OutputLineIntent[] {
    return result.perTest.flatMap(function propertyDiagnostics(testResult) {
        return formatPropertyDiagnostics(testResult.property).map(function diagnosticIntent(line) {
            return stdout(`${testResult.id.title}: ${line}`, null);
        });
    });
}

export function briefSummaryIntents(result: RunResult): readonly OutputLineIntent[] {
    return [
        finishIntent(result),
        ...propertyDiagnosticIntents(result),
        ...witnessReplayLines(result.artifacts).map(function replayIntent(line) {
            return stdout(line, null);
        }),
        ...formatCoverageSummaryLines(result).map(function coverageIntent(line) {
            return stdout(line, null);
        }),
        ...formatTimingOffenderLines(result).map(function timingIntent(line) {
            return stdout(line, null);
        })
    ];
}

export function briefFailureIntents(result: RunResult, context: ReportingContext): readonly OutputLineIntent[] {
    return result.perTest.flatMap(function finalFailureIntents(testResult) {
        return testResult.outcome?.kind === 'fail'
            ? testResult.outcome.failures.map(function finalFailureIntent(failure) {
                return failureIntent(testResult.id, failure, context);
            })
            : [];
    });
}
