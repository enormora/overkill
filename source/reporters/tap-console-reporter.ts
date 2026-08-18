import { formatCaseId } from '../engine/identity.ts';
import type { PerTestResult, RunResult } from '../engine/run-result.ts';
import type { FinalResultReporter, RealTimeReporter, ReporterEvent } from '../engine/reporter.ts';
import { formatFailureSummary } from './failure-summary.ts';

export type TapConsoleReporterDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

type TapPoint = {
    readonly id: PerTestResult['id'];
    readonly outcome: PerTestResult['outcome'];
};

function statusForOutcome(outcome: TapPoint['outcome']): 'not ok' | 'ok' {
    if (outcome.kind === 'fail' || outcome.kind === 'inconclusive') {
        return 'not ok';
    }

    return 'ok';
}

function diagnosticReason(outcome: TapPoint['outcome']): string | null {
    if (outcome.kind === 'fail') {
        return formatFailureSummary(outcome.failures[0]);
    }

    if (outcome.kind === 'inconclusive') {
        return outcome.reason;
    }

    return null;
}

function formatDiagnostics(outcome: TapPoint['outcome']): string {
    const reason = diagnosticReason(outcome);

    return reason === null ? '' : `\n  ---\n  reason: ${reason}\n  ...`;
}

function formatDirective(outcome: TapPoint['outcome']): string {
    if (outcome.kind === 'skip') {
        return ` # SKIP ${outcome.reason}`;
    }

    return '';
}

function formatTapPoint(tapPoint: TapPoint, index: number): string {
    return [
        `${statusForOutcome(tapPoint.outcome)} ${index + 1} - ${formatCaseId(tapPoint.id)}`,
        formatDirective(tapPoint.outcome),
        formatDiagnostics(tapPoint.outcome)
    ]
        .join('');
}

function formatResultAsTap(testRunResult: RunResult): string {
    const version = 'TAP version 14';
    const plan = `1..${testRunResult.summary.planned}`;
    const testPoints = testRunResult.perTest.map(formatTapPoint);

    return `${version}\n${plan}\n${testPoints.join('\n')}\n`;
}

function formatEventAsTapPoint(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    index: number
): string {
    return formatTapPoint({
        id: event.case,
        outcome: event.outcome
    }, index);
}

export function createTapConsoleReporter(dependencies: TapConsoleReporterDependencies): FinalResultReporter {
    const { stdoutConsole } = dependencies;

    return {
        dispose: null,
        kind: 'final-result',
        name: 'tap',
        sinks: [ { kind: 'stdout-raw' } ],

        async onResult(currentTestRunResult) {
            stdoutConsole.log(formatResultAsTap(currentTestRunResult));
        }
    };
}

export function createTapConsoleRealTimeReporter(dependencies: TapConsoleReporterDependencies): RealTimeReporter {
    const { stdoutConsole } = dependencies;
    let nextTestPointIndex = 0;

    return {
        dispose: null,
        kind: 'real-time',
        name: 'tap-real-time',
        sinks: [ { kind: 'stdout-raw' } ],

        async onEvent(event) {
            if (event.kind === 'run-start') {
                stdoutConsole.log('TAP version 14');
            } else if (event.kind === 'test-end') {
                stdoutConsole.log(formatEventAsTapPoint(event, nextTestPointIndex));
                nextTestPointIndex += 1;
            } else if (event.kind === 'runner-error') {
                stdoutConsole.log(`# runner error: ${event.error.message}`);
            } else if (event.kind === 'run-end') {
                stdoutConsole.log(`1..${event.result.summary.planned}`);
            }
        },

        onFinish: null
    };
}
