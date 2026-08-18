import { formatCaseId } from '../engine/identity.ts';
import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { OutputLineIntent } from '../engine/reporter-output.ts';
import type { RealTimeReporter, ReporterEvent, RunFacts } from '../engine/reporter.ts';
import type { RunResult, RunnerError, TestFailure } from '../engine/run-result.ts';
import { formatFailureSummary } from './failure-summary.ts';
import { formatSourceLocation } from './source-location-rendering.ts';

const progressInterval = 100;

type BriefReporterState = {
    readonly completed: number;
    readonly failed: number;
    readonly planned: number | null;
};

function stdout(text: string, annotation: OutputLineIntent['annotation']): OutputLineIntent {
    return {
        annotation,
        kind: 'stdout-line',
        role: 'primary',
        text
    };
}

function readPlannedCount(facts: RunFacts): number | null {
    const { cases } = facts;

    return Array.isArray(cases) ? cases.length : null;
}

function firstAssertionCheck(failure: TestFailure): FailedCheck | null {
    return failure.kind === 'assertion' ? failure.checks[0] : null;
}

function failureLocation(failure: TestFailure): SourceLocation | null {
    return firstAssertionCheck(failure)?.location ?? null;
}

function formatFailureLine(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    failure: TestFailure
): string {
    const location = failureLocation(failure);
    const locationText = location === null ? null : formatSourceLocation(location);
    const origin = locationText === null ? formatCaseId(event.case) : `${locationText} ${formatCaseId(event.case)}`;

    return `fail ${origin}: ${formatFailureSummary(failure)}`;
}

function failureIntent(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    failure: TestFailure
): OutputLineIntent {
    const location = failureLocation(failure);

    return stdout(formatFailureLine(event, failure), {
        location,
        severity: 'error',
        title: formatCaseId(event.case)
    });
}

function progressIntent(state: BriefReporterState): OutputLineIntent {
    const planned = state.planned === null ? '?' : String(state.planned);

    return stdout(`progress ${state.completed}/${planned} failed=${state.failed}`, null);
}

function shouldReportProgress(state: BriefReporterState): boolean {
    if (state.completed === 0 || state.completed % progressInterval !== 0) {
        return false;
    }

    return state.planned === null || state.completed < state.planned;
}

function executedCount(result: RunResult): number {
    const { summary } = result;

    return summary.passed + summary.failed + summary.skipped + summary.inconclusive;
}

function finishIntent(result: RunResult): OutputLineIntent {
    const { summary } = result;
    const discoveryCounts = `done discovered=${summary.discovered} planned=${summary.planned}`;
    const executionCounts = `executed=${executedCount(result)} passed=${summary.passed} failed=${summary.failed}`;
    const remainingCounts = `skipped=${summary.skipped} inconclusive=${summary.inconclusive} ms=${result.wallTimeMs}`;

    return stdout(
        `${discoveryCounts} ${executionCounts} ${remainingCounts}`,
        null
    );
}

function runnerErrorIntent(error: RunnerError): OutputLineIntent {
    return stdout(`runner-error ${error.message}`, {
        location: null,
        severity: 'error',
        title: 'Runner error'
    });
}

type BriefReporterUpdate = {
    readonly intents: readonly OutputLineIntent[];
    readonly state: BriefReporterState;
};

export type BriefReporterSinks = readonly [{ readonly kind: 'stdout-managed-primary'; }];
const briefReporterSinks: BriefReporterSinks = [ { kind: 'stdout-managed-primary' } ];

function updateForCompletedTest(state: BriefReporterState, failed: boolean): BriefReporterState {
    return {
        completed: state.completed + 1,
        failed: failed ? state.failed + 1 : state.failed,
        planned: state.planned
    };
}

function testEndUpdate(
    state: BriefReporterState,
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>
): BriefReporterUpdate {
    const nextState = updateForCompletedTest(state, event.outcome.kind === 'fail');

    if (event.outcome.kind !== 'fail') {
        return {
            intents: shouldReportProgress(nextState) ? [ progressIntent(nextState) ] : [],
            state: nextState
        };
    }

    const failureIntents = event.outcome.failures.map(function toFailureIntent(failure) {
        return failureIntent(event, failure);
    });

    return {
        intents: [
            ...failureIntents,
            ...shouldReportProgress(nextState) ? [ progressIntent(nextState) ] : []
        ],
        state: nextState
    };
}

export function createBriefReporter(): RealTimeReporter<BriefReporterSinks> {
    let state: BriefReporterState = {
        completed: 0,
        failed: 0,
        planned: null
    };

    return {
        dispose: null,
        kind: 'real-time',
        name: 'brief',
        sinks: briefReporterSinks,

        onEvent(event) {
            if (event.kind === 'run-start') {
                state = {
                    completed: state.completed,
                    failed: state.failed,
                    planned: readPlannedCount(event.facts)
                };

                return [ stdout(`run ${event.root.name}`, null) ];
            }

            if (event.kind === 'test-end') {
                const update = testEndUpdate(state, event);
                state = update.state;

                return update.intents;
            }

            if (event.kind === 'runner-error') {
                return [ runnerErrorIntent(event.error) ];
            }

            return [];
        },

        onFinish(result) {
            return [ finishIntent(result) ];
        }
    };
}
