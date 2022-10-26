import { test } from 'uvu';
import { calculateSummary, updateSuiteResult } from './suite';
import * as assert from 'uvu/assert';

test('calculateSummary() returns the correct result when there are no results', () => {
    const result = calculateSummary([], 42);

    assert.equal(result, {
        failedCount: 0,
        successCount: 0,
        totalCount: 42,
        completedCount: 0,
        pendingCount: 42,
    });
});

test('calculateSummary() returns the correct when there is one success result', () => {
    const result = calculateSummary(
        [{ testCaseDetails: { title: 'foo', index: 0 }, result: { status: 'success', duration: 100 } }],
        42,
    );

    assert.equal(result, {
        failedCount: 0,
        successCount: 1,
        totalCount: 42,
        completedCount: 1,
        pendingCount: 41,
    });
});

test('calculateSummary() returns the correct when there is one failed result', () => {
    const result = calculateSummary(
        [
            {
                testCaseDetails: { title: 'foo', index: 0 },
                result: { status: 'failure', reason: 'the-reason', duration: 100 },
            },
        ],
        42,
    );

    assert.equal(result, {
        failedCount: 1,
        successCount: 0,
        totalCount: 42,
        completedCount: 1,
        pendingCount: 41,
    });
});

test('calculateSummary() returns the correct when there is one failed and one success result', () => {
    const result = calculateSummary(
        [
            {
                testCaseDetails: { title: 'foo', index: 0 },
                result: { status: 'failure', reason: 'the-reason', duration: 100 },
            },
            {
                testCaseDetails: { title: 'bar', index: 1 },
                result: { status: 'success', duration: 100 },
            },
        ],
        42,
    );

    assert.equal(result, {
        failedCount: 1,
        successCount: 1,
        totalCount: 42,
        completedCount: 2,
        pendingCount: 40,
    });
});

test('updateSuiteResult() updates a given SuiteResult by adding the information of the given TestCaseResult', () => {
    const currentSuiteResult = {
        progress: 'pending',
        summary: {
            failedCount: 0,
            successCount: 1,
            totalCount: 42,
            completedCount: 1,
            pendingCount: 41,
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'foo', index: 0 },
                result: { status: 'success', duration: 100 },
            },
        ],
    } as const;
    const newTestCaseResult = {
        testCaseDetails: { title: 'bar', index: 1 },
        result: { status: 'failure', reason: 'the-reason', duration: 50 },
    } as const;

    const updatedResult = updateSuiteResult(currentSuiteResult, newTestCaseResult, 42);

    assert.equal(updatedResult, {
        progress: 'pending',
        summary: {
            failedCount: 1,
            successCount: 1,
            totalCount: 42,
            completedCount: 2,
            pendingCount: 40,
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'foo', index: 0 },
                result: { status: 'success', duration: 100 },
            },
            {
                testCaseDetails: { title: 'bar', index: 1 },
                result: { status: 'failure', reason: 'the-reason', duration: 50 },
            },
        ],
    });
});

test.run();
