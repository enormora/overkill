import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import { runStatusFromPlan, type RunResult, type RunnerError, type PerTestResult } from '../engine/run-result.ts';
import { failedPerformanceBaselineCheck } from '../baselines/performance-check.ts';
import type { BaselineDiagnostic } from '../baselines/performance-adapter.ts';

export type BaselineCaseEnd = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
export function baselineRunnerError(error: unknown, event: BaselineCaseEnd | null): RunnerError {
    return {
        attributedTo: event === null ? null : event.case,
        attributedToAttempt: event === null ? null : { index: event.attempt },
        attributedToWork: event === null ? null : event.workId ?? createDefaultWorkId(event.case),
        cause: error,
        diagnostics: [],
        message: error instanceof Error ? error.message : String(error),
        subtype: 'artifact'
    };
}
export function baselineFailedCheck(
    event: BaselineCaseEnd,
    id: string,
    diagnostic: BaselineDiagnostic
): FailedCheck {
    return failedPerformanceBaselineCheck({ ...diagnostic, event, id: `baseline:${id}` });
}
export function withBaselineChecks(event: BaselineCaseEnd, checks: readonly FailedCheck[]): BaselineCaseEnd {
    const [ first, ...rest ] = checks;
    return first === undefined ? event : {
        ...event,
        outcome: { failures: [ { checks: [ first, ...rest ], kind: 'assertion' } ], kind: 'fail' },
        verdict: 'fail'
    };
}
export function withBaselineVerdicts(result: RunResult, events: ReadonlyMap<string, BaselineCaseEnd>): RunResult {
    const perTest = result.perTest.map(function baselineCase(testResult): PerTestResult {
        const event = events.get(workIdentityKey(testResult.workId));
        if (event === undefined || event.verdict === 'pass' || testResult.verdict !== 'pass') {
            return testResult;
        }
        const [ first, ...rest ] = testResult.attempts;
        const attempts = [ first, ...rest ].map(function finalAttempt(attempt) {
            return attempt.attempt.index === event.attempt
                ? { ...attempt, outcome: event.outcome, verdict: event.verdict }
                : attempt;
        });
        const [ initial, ...remaining ] = attempts;
        if (initial === undefined) {
            throw new Error('Baseline case has no execution attempt.');
        }
        return {
            ...testResult,
            attempts: [ initial, ...remaining ],
            outcome: event.outcome,
            verdict: event.verdict,
            retried: testResult.retried === null ? null : { ...testResult.retried, finalVerdict: event.verdict }
        };
    });
    const summary = {
        ...result.summary,
        failed: perTest
            .filter(function failed(entry) {
                return entry.verdict === 'fail';
            })
            .length,
        passed: perTest
            .filter(function passed(entry) {
                return entry.verdict === 'pass';
            })
            .length
    };
    return { ...result, perTest, summary, status: runStatusFromPlan(summary, result.runnerErrors, result.planStatus) };
}
export function successfulBaselineRun(result: RunResult): boolean {
    const allCasesCompleted = result.perTest.every(function completed(entry) {
        return entry.verdict === 'pass' || entry.verdict === 'skip';
    });
    const completeCount = result.perTest.length === result.summary.planned;
    return result.status === 'passed' && result.planStatus === 'planned' && result.runnerErrors.length === 0 &&
        completeCount && allCasesCompleted;
}
