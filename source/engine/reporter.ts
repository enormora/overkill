import type { RunResult, TestOutcome } from './run-result.ts';
import type { TestCaseResult } from './test-case-executor.ts';
import type { TestRunResult } from './test-run-result.ts';

export type SinkDeclaration = {
    readonly conflictPolicy: 'exclusive' | 'shared';
    readonly kind: 'stderr' | 'stdout';
};

export type ReporterEvent = {
    readonly attempt: number | null;
    readonly case: string | null;
    readonly facts: Readonly<Record<string, unknown>> | null;
    readonly kind: 'run-end' | 'run-start' | 'test-end' | 'test-start';
    readonly outcome: TestOutcome | null;
    readonly result: RunResult | null;
    readonly startedAt: string | null;
    readonly verdict: string | null;
    readonly wallTimeMs: number | null;
};

export type ReportingSession = {
    readonly report: (testRunResult: TestRunResult) => Promise<void> | void;
};

export type RealTimeReportingSession = ReportingSession & {
    readonly done: (testRunResult: TestRunResult) => Promise<void> | void;
    readonly progress: (testRunResult: TestRunResult, testCaseResult: TestCaseResult) => Promise<void> | void;
    readonly start: (testRunResult: TestRunResult) => Promise<void> | void;
};

export type LegacyReporter = {
    readonly createSession: (sessionId: number) => ReportingSession;
};

export type RealTimeReporter = {
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onEvent: (event: ReporterEvent) => Promise<void> | void;
    readonly onFinish: (result: RunResult) => Promise<void> | void;
};

export type FinalResultReporter = {
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onResult: (result: RunResult) => Promise<void> | void;
};

export type Reporter = FinalResultReporter | RealTimeReporter;

export function isRealTimeReportingSession(
    reportingSession: ReportingSession
): reportingSession is RealTimeReportingSession {
    return (
        Object.hasOwn(reportingSession, 'done') &&
        Object.hasOwn(reportingSession, 'progress') &&
        Object.hasOwn(reportingSession, 'start')
    );
}

export async function reportEvent(reporters: readonly Reporter[], event: ReporterEvent): Promise<void> {
    for (const reporter of reporters) {
        if (reporter.kind === 'real-time') {
            await reporter.onEvent(event);
        }
    }
}

export async function reportResult(reporters: readonly Reporter[], result: RunResult): Promise<void> {
    for (const reporter of reporters) {
        if (reporter.kind === 'final-result') {
            await reporter.onResult(result);
        } else {
            await reporter.onFinish(result);
        }
    }
}
