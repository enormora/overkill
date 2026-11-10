import type { OutputLineIntent } from '../engine/reporter-output.ts';
import {
    defineReporter,
    type DefinedReporter,
    type RealTimeReporter,
    type ReporterEvent,
    type RunFacts
} from '../engine/reporter.ts';
import type { ReportingContext } from '../engine/reporting-context.ts';
import {
    briefReporterSinks,
    type BriefReporterSinks,
    briefSummaryIntents,
    failureIntent,
    runnerErrorIntent,
    stdout
} from './brief-reporter-rendering.ts';
import { formatRunFactSummary } from './run-summary-rendering.ts';

const progressInterval = 100;

type BriefReporterState = {
    readonly completed: number;
    readonly failed: number;
    readonly planned: number | null;
};

type BriefReporterUpdate = {
    readonly intents: readonly OutputLineIntent[];
    readonly state: BriefReporterState;
};

function readPlannedCount(facts: RunFacts): number | null {
    const { cases } = facts;

    return Array.isArray(cases) ? cases.length : null;
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

function updateForCompletedTest(state: BriefReporterState, failed: boolean): BriefReporterState {
    return {
        completed: state.completed + 1,
        failed: failed ? state.failed + 1 : state.failed,
        planned: state.planned
    };
}

function testEndUpdate(
    state: BriefReporterState,
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    context: ReportingContext
): BriefReporterUpdate {
    if (event.completion === 'retry') {
        return { intents: [ stdout(`retry ${event.attempt + 1}: ${event.case.title}`, null) ], state };
    }
    const nextState = updateForCompletedTest(state, event.verdict === 'fail');

    if (event.outcome?.kind !== 'fail') {
        return {
            intents: shouldReportProgress(nextState) ? [ progressIntent(nextState) ] : [],
            state: nextState
        };
    }

    const failureIntents = event.outcome.failures.map(function toFailureIntent(failure) {
        return failureIntent(event.case, failure, context);
    });

    return {
        intents: [
            ...failureIntents,
            ...shouldReportProgress(nextState) ? [ progressIntent(nextState) ] : []
        ],
        state: nextState
    };
}

function runStartIntent(event: Extract<ReporterEvent, { readonly kind: 'run-start'; }>): OutputLineIntent {
    const summary = formatRunFactSummary(event.facts);
    const details = summary === null ? '' : ` ${summary}`;

    return stdout(`run ${event.root.title}${details}`, null);
}

export function createBriefReporter(): DefinedReporter<RealTimeReporter<BriefReporterSinks>> {
    return defineReporter(function createBriefRuntimeReporter(context) {
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

                    return [ runStartIntent(event) ];
                }

                if (event.kind === 'test-end') {
                    const update = testEndUpdate(state, event, context);
                    state = update.state;

                    return update.intents;
                }

                if (event.kind === 'runner-error') {
                    return [ runnerErrorIntent(event.error) ];
                }

                return [];
            },

            onFinish: briefSummaryIntents
        };
    });
}
