import type { TestCaseResult } from './test-case-executor';

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

export function calculateSummary(results: readonly TestCaseResult[], totalCount: number): ResultSummary {
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

export function updateSuiteResult(
    suiteResult: SuiteResult,
    testResult: TestCaseResult,
    totalCount: number,
): SuiteResult {
    const testCaseResults = [...suiteResult.testCaseResults, testResult];

    return {
        progress: suiteResult.progress,
        summary: calculateSummary(testCaseResults, totalCount),
        testCaseResults,
    };
}
