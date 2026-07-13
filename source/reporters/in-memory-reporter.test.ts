import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInMemoryRealTimeReporter, createInMemoryFinalResultReporter } from './in-memory-reporter.ts';

const testRunResult = {
    progress: 'pending',
    summary: { failedCount: 0, totalCount: 0, successCount: 0, completedCount: 0, pendingCount: 0 },
    testCaseResults: []
} as const;

test('in-memory real-time reporter reports a session start', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.start(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { sessionId: 42, type: 'start', testRunResult } ]);
});

test('in-memory real-time reporter reports progress', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);
    const testCaseResult = {
        testCaseDetails: { title: 'foo', index: 42, suiteTitle: 'bar' },
        result: { status: 'success', duration: 100 }
    } as const;

    await session.progress(testRunResult, testCaseResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ {
        sessionId: 42,
        type: 'progress',
        testRunResult,
        testCaseResult
    } ]);
});

test('in-memory real-time reporter reports when the session finished', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.done(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { sessionId: 42, type: 'done', testRunResult } ]);
});

test('in-memory real-time reporter collects reports from multiple sessions', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const firstSession = reporter.createSession(1);
    const secondSession = reporter.createSession(2);

    await firstSession.start(testRunResult);
    await secondSession.start(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [
        { sessionId: 1, type: 'start', testRunResult },
        { sessionId: 2, type: 'start', testRunResult }
    ]);
});

test('in-memory real-time reporter collects multiple reports for one session', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.start(testRunResult);
    await session.done(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [
        { sessionId: 42, type: 'start', testRunResult },
        { sessionId: 42, type: 'done', testRunResult }
    ]);
});

test('in-memory final-result reporter reports when the session finished', async function () {
    const reporter = createInMemoryFinalResultReporter();
    const session = reporter.createSession(42);

    await session.report(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { sessionId: 42, type: 'done', testRunResult } ]);
});

test('in-memory final-result reporter collects reports from multiple sessions', async function () {
    const reporter = createInMemoryFinalResultReporter();
    const firstSession = reporter.createSession(1);
    const secondSession = reporter.createSession(2);

    await firstSession.report(testRunResult);
    await secondSession.report(testRunResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [
        { sessionId: 1, type: 'done', testRunResult },
        { sessionId: 2, type: 'done', testRunResult }
    ]);
});
