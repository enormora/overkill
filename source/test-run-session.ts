import type { Reporter } from './reporter/reporter.js';
import { isRealTimeReportingSession } from './reporter/reporter.js';
import type { SuiteResult } from './suite.js';
import { updateSuiteResult, calculateSummary } from './suite.js';
import type { TestCase } from './test-case.js';
import type { TestCaseExecutor, TestCaseResult } from './test-case-executor.js';

export interface TestRunSessionProviderDependencies {
    readonly testCaseExecutor: TestCaseExecutor;
    readonly reporter: Reporter;
}

interface TestRunSession {
    start(): Promise<void>;
    runSingleTestCase(testCase: TestCase): Promise<TestCaseResult>;
    done(testCaseResults: readonly TestCaseResult[]): Promise<SuiteResult>;
}

export interface TestRunSessionProvider {
    createTestRunSession(sessionId: number, totalCount: number): TestRunSession;
}

export function createTestRunSessionProvider(dependencies: TestRunSessionProviderDependencies): TestRunSessionProvider {
    const { testCaseExecutor, reporter } = dependencies;

    return {
        createTestRunSession(sessionId, totalCount) {
            let currentSuiteResult: SuiteResult = {
                progress: 'pending',
                summary: calculateSummary([], totalCount),
                testCaseResults: [],
            };
            const reportingSession = reporter.createSession(sessionId);

            return {
                async start() {
                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.start(currentSuiteResult);
                    }
                },

                async runSingleTestCase(testCase) {
                    const { testFunction, ...testCaseDetails } = testCase;
                    const result = await testCaseExecutor.execute(testFunction);
                    const testCaseResult = { testCaseDetails, result };

                    currentSuiteResult = updateSuiteResult(currentSuiteResult, testCaseResult, totalCount);
                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.progress(currentSuiteResult, testCaseResult);
                    }

                    return testCaseResult;
                },

                async done(testCaseResults) {
                    const finalResult: SuiteResult = {
                        progress: 'completed',
                        summary: calculateSummary(testCaseResults, totalCount),
                        testCaseResults,
                    };

                    if (isRealTimeReportingSession(reportingSession)) {
                        await reportingSession.done(finalResult);
                    } else {
                        await reportingSession.report(finalResult);
                    }

                    return finalResult;
                },
            };
        },
    };
}
