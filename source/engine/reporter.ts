import type { TestRunResult } from './test-run-result.js';
import type { TestCaseResult } from './test-case-executor.js';

type RealTimeReportingSession = {
    start: (currentTestRunResult: TestRunResult) => Promise<void>;
    progress: (currentTestRunResult: TestRunResult, testCaseResult: TestCaseResult) => Promise<void>;
    done: (finalResult: TestRunResult) => Promise<void>;
    readonly report?: undefined;
};

type FinalResultReportingSession = {
    readonly start?: undefined;
    readonly progress?: undefined;
    readonly done?: undefined;
    report: (finalResult: TestRunResult) => Promise<void>;
};

export type ReportingSession = FinalResultReportingSession | RealTimeReportingSession;

export type RealTimeReporter = {
    createSession: (sessionId: number) => RealTimeReportingSession;
};

export type FinalResultReporter = {
    createSession: (sessionId: number) => FinalResultReportingSession;
};

export function isRealTimeReportingSession(session: ReportingSession): session is RealTimeReportingSession {
    return typeof session.start === 'function';
}

export type Reporter = FinalResultReporter | RealTimeReporter;
