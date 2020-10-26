export type TestResultStatus = 'failure' | 'success';

export interface FailureTestResult {
  status: 'failure';
  reason: string;
}

export interface SuccessTestResult {
  status: 'success';
}

export type TestResult = FailureTestResult | SuccessTestResult;

export type TestFn = () => void;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export function runTest(testFn: TestFn): TestResult {
  try {
    testFn();

    return {
      status: 'success',
    };
  } catch (error: unknown) {
    return {
      status: 'failure',
      reason: extractErrorMessage(error),
    };
  }
}
