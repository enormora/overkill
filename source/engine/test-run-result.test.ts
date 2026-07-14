import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { calculateSummary, updateTestRunResult } from './test-run-result.ts';

registerTest('calculateSummary() returns the correct result when there are no results', function () {
    const result = calculateSummary([], 42);

    assert.deepStrictEqual(result, {
        failedCount: 0,
        successCount: 0,
        totalCount: 42,
        completedCount: 0,
        pendingCount: 42
    });
});

registerTest('calculateSummary() returns the correct when there is one success result', function () {
    const result = calculateSummary(
        [
            {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'success', duration: 100 }
            }
        ],
        42
    );

    assert.deepStrictEqual(result, {
        failedCount: 0,
        successCount: 1,
        totalCount: 42,
        completedCount: 1,
        pendingCount: 41
    });
});

registerTest('calculateSummary() returns the correct when there is one failed result', function () {
    const result = calculateSummary(
        [
            {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'failure', reason: 'the-reason', duration: 100 }
            }
        ],
        42
    );

    assert.deepStrictEqual(result, {
        failedCount: 1,
        successCount: 0,
        totalCount: 42,
        completedCount: 1,
        pendingCount: 41
    });
});

registerTest('calculateSummary() returns the correct when there is one failed and one success result', function () {
    const result = calculateSummary(
        [
            {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'failure', reason: 'the-reason', duration: 100 }
            },
            {
                testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                result: { status: 'success', duration: 100 }
            }
        ],
        42
    );

    assert.deepStrictEqual(result, {
        failedCount: 1,
        successCount: 1,
        totalCount: 42,
        completedCount: 2,
        pendingCount: 40
    });
});

registerTest(
    'updateTestRunResult() updates a given TestRunResult by adding the information of the given TestCaseResult',
    function () {
        const currentTestRunResult = {
            progress: 'pending',
            summary: {
                failedCount: 0,
                successCount: 1,
                totalCount: 42,
                completedCount: 1,
                pendingCount: 41
            },
            testCaseResults: [
                {
                    testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                    result: { status: 'success', duration: 100 }
                }
            ]
        } as const;
        const newTestCaseResult = {
            testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
            result: { status: 'failure', reason: 'the-reason', duration: 50 }
        } as const;

        const updatedResult = updateTestRunResult(currentTestRunResult, newTestCaseResult, 42);

        assert.deepStrictEqual(updatedResult, {
            progress: 'pending',
            summary: {
                failedCount: 1,
                successCount: 1,
                totalCount: 42,
                completedCount: 2,
                pendingCount: 40
            },
            testCaseResults: [
                {
                    testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                    result: { status: 'success', duration: 100 }
                },
                {
                    testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                    result: { status: 'failure', reason: 'the-reason', duration: 50 }
                }
            ]
        });
    }
);
