import type { Reporter } from './reporter.js';
import { isRealTimeReportingSession } from './reporter.js';
import type { TestRunResult } from './test-run-result.js';
import { updateTestRunResult, calculateSummary } from './test-run-result.js';
import type { TestCase } from './test-case.js';
import type { TestCaseExecutor, TestCaseResult } from './test-case-executor.js';

export type TestRunSessionProviderDependencies = {
    readonly testCaseExecutor: TestCaseExecutor;
    readonly reporter: Reporter;
};

type TestRunSession = {
    start: () => Promise<void>;
    runSingleTestCase: (testCase: TestCase, index: number) => Promise<TestCaseResult>;
    done: (testCaseResults: readonly TestCaseResult[]) => Promise<TestRunResult>;
};

export type TestRunSessionProvider = {
    createTestRunSession: (sessionId: number, totalCount: number) => TestRunSession;
};

export function createTestRunSessionProvider(dependencies: TestRunSessionProviderDependencies): TestRunSessionProvider {
    const { testCaseExecutor, reporter } = dependencies;

    return {
        createTestRunSession(sessionId, totalCount) {
            let currentTestRunResult: TestRunResult = {
                progress: 'pending',
                summary: calculateSummary([], totalCount),
                testCaseResults: []
            };
            const reportingSession = reporter.createSession(sessionId);

            return {
                async start() {
                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.start(currentTestRunResult);
                    }
                },

                async runSingleTestCase(testCase, index) {
                    const { testFunction, title, suiteTitle } = testCase;
                    const result = await testCaseExecutor.execute(testFunction);
                    const testCaseResult = { testCaseDetails: { title, suiteTitle, index }, result };

                    currentTestRunResult = updateTestRunResult(currentTestRunResult, testCaseResult, totalCount);
                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.progress(currentTestRunResult, testCaseResult);
                    }

                    return testCaseResult;
                },

                async done(testCaseResults) {
                    const finalResult: TestRunResult = {
                        progress: 'completed',
                        summary: calculateSummary(testCaseResults, totalCount),
                        testCaseResults
                    };

                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.done(finalResult);
                    } else {
                        await reportingSession.report(finalResult);
                    }

                    return finalResult;
                }
            };
        }
    };
}
