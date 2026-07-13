import type { TestCaseResult } from './test-case-executor.js';

type TestRunResultSummary = {
    readonly failedCount: number;
    readonly successCount: number;
    readonly totalCount: number;
    readonly completedCount: number;
    readonly pendingCount: number;
};

export type TestRunResult = {
    readonly progress: 'completed' | 'pending';
    readonly summary: TestRunResultSummary;
    readonly testCaseResults: readonly TestCaseResult[];
};

function addResultToSummary(summary: TestRunResultSummary, testCaseResult: TestCaseResult): TestRunResultSummary {
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
        pendingCount: summary.pendingCount
    };
}

export function calculateSummary(results: readonly TestCaseResult[], totalCount: number): TestRunResultSummary {
    const completedCount = results.length;
    const initialSummary: TestRunResultSummary = {
        failedCount: 0,
        successCount: 0,
        totalCount,
        completedCount,
        pendingCount: totalCount - completedCount
    };

    return results.reduce(addResultToSummary, initialSummary);
}

export function updateTestRunResult(
    testRunResult: TestRunResult,
    testResult: TestCaseResult,
    totalCount: number
): TestRunResult {
    const testCaseResults = [ ...testRunResult.testCaseResults, testResult ];

    return {
        progress: testRunResult.progress,
        summary: calculateSummary(testCaseResults, totalCount),
        testCaseResults
    };
}
