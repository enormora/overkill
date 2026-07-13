import type { TestCaseDetails, TestFunction } from './test-case.ts';

export type TestResultStatus = 'failure' | 'success';

type BaseTestResult = {
    readonly status: TestResultStatus;
    readonly duration: number;
};

export type FailureTestResult = BaseTestResult & {
    readonly status: 'failure';
    readonly reason: string;
};

export type SuccessTestResult = BaseTestResult & {
    readonly status: 'success';
    readonly reason?: undefined;
};

export type TestResult = FailureTestResult | SuccessTestResult;

export type TestCaseResult = {
    readonly testCaseDetails: TestCaseDetails;
    readonly result: TestResult;
};

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return 'Unknown error';
}

async function runTestFunction(testFunction: TestFunction): Promise<void> {
    const promise = testFunction();

    if (promise !== undefined) {
        await promise;
    }
}

export type TestCaseExecutorDependencies = {
    readonly timingApi: Performance;
};

export type TestCaseExecutor = {
    execute: (testFunction: TestFunction) => Promise<TestResult>;
};

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
                await runTestFunction(testFunction);

                return {
                    status: 'success',
                    duration: calculateDuration(startTime)
                };
            } catch (error: unknown) {
                return {
                    status: 'failure',
                    duration: calculateDuration(startTime),
                    reason: extractErrorMessage(error)
                };
            }
        }
    };
}
