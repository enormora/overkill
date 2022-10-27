import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { createInMemoryRealTimeReporter, createInMemoryFinalResultReporter } from './in-memory-reporter';

const suiteResult = {
    progress: 'pending',
    summary: { failedCount: 0, totalCount: 0, successCount: 0, completedCount: 0, pendingCount: 0 },
    testCaseResults: [],
} as const;

test('in-memory real-time reporter reports a session start', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.start(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [{ sessionId: 42, type: 'start', suiteResult }]);
});

test('in-memory real-time reporter reports progress', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);
    const testCaseResult = {
        testCaseDetails: { title: 'foo', index: 42 },
        result: { status: 'success', duration: 100 },
    } as const;

    await session.progress(suiteResult, testCaseResult);

    assert.equal(reporter.getRecordedEntries(), [{ sessionId: 42, type: 'progress', suiteResult, testCaseResult }]);
});

test('in-memory real-time reporter reports when the session finished', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.done(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [{ sessionId: 42, type: 'done', suiteResult }]);
});

test('in-memory real-time reporter collects reports from multiple sessions', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const firstSession = reporter.createSession(1);
    const secondSession = reporter.createSession(2);

    await firstSession.start(suiteResult);
    await secondSession.start(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [
        { sessionId: 1, type: 'start', suiteResult },
        { sessionId: 2, type: 'start', suiteResult },
    ]);
});

test('in-memory real-time reporter collects multiple reports for one session', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const session = reporter.createSession(42);

    await session.start(suiteResult);
    await session.done(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [
        { sessionId: 42, type: 'start', suiteResult },
        { sessionId: 42, type: 'done', suiteResult },
    ]);
});

test('in-memory final-result reporter reports when the session finished', async () => {
    const reporter = createInMemoryFinalResultReporter();
    const session = reporter.createSession(42);

    await session.report(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [{ sessionId: 42, type: 'done', suiteResult }]);
});

test('in-memory final-result reporter collects reports from multiple sessions', async () => {
    const reporter = createInMemoryFinalResultReporter();
    const firstSession = reporter.createSession(1);
    const secondSession = reporter.createSession(2);

    await firstSession.report(suiteResult);
    await secondSession.report(suiteResult);

    assert.equal(reporter.getRecordedEntries(), [
        { sessionId: 1, type: 'done', suiteResult },
        { sessionId: 2, type: 'done', suiteResult },
    ]);
});

test.run();
