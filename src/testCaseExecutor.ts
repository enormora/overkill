import { TestFn } from './testCase';
export type TestResultStatus = 'failure' | 'success';

interface BaseTestResult {
  status: TestResultStatus;
  duration: number;
}

export interface FailureTestResult extends BaseTestResult {
  status: 'failure';
  reason: string;
}

export interface SuccessTestResult extends BaseTestResult {
  status: 'success';
}

export type TestResult = FailureTestResult | SuccessTestResult;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export interface TestCaseExecutorDependencies {
  timingApi: Performance;
}

export interface TestCaseExecutor {
  execute(testFn: TestFn): TestResult;
}

export function createTestCaseExecutor(dependencies: TestCaseExecutorDependencies): TestCaseExecutor {
  const { timingApi } = dependencies;

  function calculateDuration(startTime: number): number {
    const endTime = timingApi.now();
    return endTime - startTime;
  }

  return {
    execute(testFn) {
      const startTime = timingApi.now();

      try {
        testFn();

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
