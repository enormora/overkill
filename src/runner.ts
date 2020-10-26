import { TestCase, TestCaseDetails } from './testCase';
import { TestCaseExecutor, TestResult } from './testCaseExecutor';

interface TestCaseResult {
  testCaseDetails: TestCaseDetails;
  result: TestResult;
}

interface ResultSummary {
  failedCount: number;
  successCount: number;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
}

interface SuiteResult {
  progress: 'pending' | 'completed';
  summary: ResultSummary;
  testCaseResults: readonly TestCaseResult[];
}

export interface RunnerDependencies {
  testCaseExecutor: TestCaseExecutor;
}

export interface Runner {
  addTestCase(testCase: TestCase): void;
  runAll(): SuiteResult;
}

function addResultToSummary(summary: ResultSummary, testCaseResult: TestCaseResult): ResultSummary {
  let { failedCount, successCount } = summary;

  if (testCaseResult.result.status === 'failure') {
    failedCount += 1;
  } else {
    successCount += 1;
  }

  return {
    failedCount,
    successCount,
    totalCount: summary.totalCount,
    completedCount: summary.completedCount,
    pendingCount: summary.pendingCount,
  };
}

function calculateSummary(results: TestCaseResult[]): ResultSummary {
  const initialSummary: ResultSummary = {
    failedCount: 0,
    successCount: 0,
    totalCount: results.length,
    completedCount: results.length,
    pendingCount: 0,
  };

  return results.reduce(addResultToSummary, initialSummary);
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
        summary: calculateSummary(testCaseResults),
        testCaseResults,
      };
    },
  };
}
