import type { TestRunResult } from '../test-run-result.js';
import type { TestCaseResult } from '../test-case-executor.js';

interface RealTimeReportingSession {
    start(currentTestRunResult: TestRunResult): Promise<void>;
    progress(currentTestRunResult: TestRunResult, testCaseResult: TestCaseResult): Promise<void>;
    done(finalResult: TestRunResult): Promise<void>;
    readonly report?: undefined;
}

interface FinalResultReportingSession {
    readonly start?: undefined;
    readonly progress?: undefined;
    readonly done?: undefined;
    report(finalResult: TestRunResult): Promise<void>;
}

export type ReportingSession = RealTimeReportingSession | FinalResultReportingSession;

export interface RealTimeReporter {
    createSession(sessionId: number): RealTimeReportingSession;
}

export interface FinalResultReporter {
    createSession(sessionId: number): FinalResultReportingSession;
}

export function isRealTimeReportingSession(session: ReportingSession): session is RealTimeReportingSession {
    return typeof session.start === 'function';
}

export type Reporter = RealTimeReporter | FinalResultReporter;
