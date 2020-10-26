import { TestCase, TestCaseDetails } from './testCase';
import { TestCaseExecutor, TestResult } from './testCaseExecutor';

interface TestCaseResult {
  testCaseDetails: TestCaseDetails;
  result: TestResult;
}

interface SuiteResult {
  progress: 'pending' | 'completed';
  testCaseResults: readonly TestCaseResult[];
}

export interface RunnerDependencies {
  testCaseExecutor: TestCaseExecutor;
}

export interface Runner {
  addTestCase(testCase: TestCase): void;
  runAll(): SuiteResult;
}

export function createRunner(dependencies: RunnerDependencies): Runner {
  const { testCaseExecutor } = dependencies;
  const testCases: TestCase[] = [];

  function runTest(testCase: TestCase): TestCaseResult {
    const { testFn, ...testCaseDetails } = testCase;
    const result = testCaseExecutor.execute(testFn);

    return {
      testCaseDetails,
      result,
    };
  }

  return {
    addTestCase(testCase) {
      testCases.push(testCase);
    },

    runAll() {
      const testCaseResults = testCases.map(runTest);

      return {
        progress: 'completed',
        totalCount: testCases.length,
        testCaseResults,
      };
    },
  };
}
