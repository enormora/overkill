import type { TestCaseDetails, TestFunction } from './test-case.js';

export type TestResultStatus = 'failure' | 'success';

interface BaseTestResult {
    readonly status: TestResultStatus;
    readonly duration: number;
}

export interface FailureTestResult extends BaseTestResult {
    readonly status: 'failure';
    readonly reason: string;
}

export interface SuccessTestResult extends BaseTestResult {
    readonly status: 'success';
    readonly reason?: undefined;
}

export type TestResult = FailureTestResult | SuccessTestResult;

export interface TestCaseResult {
    readonly testCaseDetails: TestCaseDetails;
    readonly result: TestResult;
}

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return 'Unknown error';
}

export interface TestCaseExecutorDependencies {
    readonly timingApi: Performance;
}

export interface TestCaseExecutor {
    execute(testFunction: TestFunction): Promise<TestResult>;
}

export function createTestCaseExecutor(dependencies: TestCaseExecutorDependencies): TestCaseExecutor {
    const { timingApi } = dependencies;

    function calculateDuration(startTime: number): number {
        const endTime = timingApi.now();
        return endTime - startTime;
    }

    return {
        async execute(testFunction) {
            const startTime = timingApi.now();

            try {
                const promise = testFunction();

                if (typeof promise !== 'undefined') {
                    await promise;
                }

                return {
                    status: 'success',
                    duration: calculateDuration(startTime),
                };
            } catch (error: unknown) {
                return {
                    status: 'failure',
                    duration: calculateDuration(startTime),
                    reason: extractErrorMessage(error),
                };
            }
        },
    };
}
