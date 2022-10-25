import { Reporter } from './reporter/reporter';
import { TestCase, TestCaseInput, TestCaseDetails } from './test-case';
import { TestCaseExecutor, TestResult } from './test-case-executor';

export interface TestCaseResult {
    readonly testCaseDetails: TestCaseDetails;
    readonly result: TestResult;
}

interface ResultSummary {
    readonly failedCount: number;
    readonly successCount: number;
    readonly totalCount: number;
    readonly completedCount: number;
    readonly pendingCount: number;
}

export interface SuiteResult {
    readonly progress: 'pending' | 'completed';
    readonly summary: ResultSummary;
    readonly testCaseResults: readonly TestCaseResult[];
}

export interface RunnerDependencies {
    readonly testCaseExecutor: TestCaseExecutor;
    readonly reporter: Reporter;
}

export interface Runner {
    addTestCase(testCaseInput: TestCaseInput): void;
    runAll(): Promise<SuiteResult>;
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

function calculateSummary(results: readonly TestCaseResult[], totalCount: number): ResultSummary {
    const completedCount = results.length;
    const initialSummary: ResultSummary = {
        failedCount: 0,
        successCount: 0,
        totalCount,
        completedCount,
        pendingCount: totalCount - completedCount,
    };

    return results.reduce(addResultToSummary, initialSummary);
}

function updateSuiteResult(suiteResult: SuiteResult, testResult: TestCaseResult, totalCount: number): SuiteResult {
    const testCaseResults = [...suiteResult.testCaseResults, testResult];

    return {
        progress: suiteResult.progress,
        summary: calculateSummary(testCaseResults, totalCount),
        testCaseResults,
    };
}

export function createRunner(dependencies: RunnerDependencies): Runner {
    const { testCaseExecutor, reporter } = dependencies;
    const testCases: TestCase[] = [];
    let currentSuiteResult: SuiteResult = {
        progress: 'pending',
        summary: calculateSummary([], 0),
        testCaseResults: [],
    };

    async function runTest(testCase: TestCase): Promise<TestCaseResult> {
        const { testFn, ...testCaseDetails } = testCase;
        const result = testCaseExecutor.execute(testFn);
        const testCaseResult = { testCaseDetails, result };

        currentSuiteResult = updateSuiteResult(currentSuiteResult, testCaseResult, testCases.length);
        await reporter.update(currentSuiteResult);

        return testCaseResult;
    }

    return {
        addTestCase({ title, testFn }) {
            const testCase = {
                title,
                index: testCases.length,
                testFn,
            };

            testCases.push(testCase);
        },

        async runAll() {
            const testCaseResults = await Promise.all(testCases.map(runTest));

            return {
                progress: 'completed',
                summary: calculateSummary(testCaseResults, testCases.length),
                testCaseResults,
            };
        },
    };
}
