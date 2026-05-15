import { test } from 'uvu';
import * as assert from 'uvu/assert';
import type { SinonSpy } from 'sinon';
import sinon from 'sinon';
import type { TestRunSessionProvider, TestRunSessionProviderDependencies } from './test-run-session.js';
import { createTestRunSessionProvider } from './test-run-session.js';
import type { InMemoryReporter } from '../reporters/in-memory-reporter.js';
import { createInMemoryFinalResultReporter, createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.js';

function noop() {}

interface Overrides {
    readonly execute?: SinonSpy;
    readonly reporter?: InMemoryReporter;
}

function testRunSessionProviderFactory(overrides: Overrides = {}): TestRunSessionProvider {
    const { execute = sinon.fake.returns({}), reporter = createInMemoryFinalResultReporter() } = overrides;

    const fakeDependencies = {
        testCaseExecutor: {
            execute,
        },
        reporter,
    } as unknown as TestRunSessionProviderDependencies;

    return createTestRunSessionProvider(fakeDependencies);
}

test('runSingleTestCase() executes the given test case', async () => {
    const execute = sinon.fake.returns({});
    const provider = testRunSessionProviderFactory({ execute });
    const session = provider.createTestRunSession(42, 21);

    await session.runSingleTestCase({ title: 'foo', testFunction: noop, suiteTitle: 'bar' }, 0);

    assert.is(execute.callCount, 1);
    assert.equal(execute.firstCall.args, [noop]);
});

test('runSingleTestCase() reports the progress to the current reporter when it is a real-time reporter', async () => {
    const execute = sinon.fake.returns({ status: 'success', duration: 100 });
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ execute, reporter });
    const session = provider.createTestRunSession(42, 21);

    await session.runSingleTestCase({ title: 'foo', testFunction: noop, suiteTitle: 'bar' }, 0);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'progress',
            testRunResult: {
                progress: 'pending',
                summary: {
                    failedCount: 0,
                    successCount: 1,
                    totalCount: 21,
                    completedCount: 1,
                    pendingCount: 20,
                },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
                        result: { status: 'success', duration: 100 },
                    },
                ],
            },
            testCaseResult: {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
                result: { status: 'success', duration: 100 },
            },
        },
    ]);
});

test('runSingleTestCase() doesn’t report the progress to the current reporter when it is NOT a real-time reporter', async () => {
    const execute = sinon.fake.returns({ status: 'success', duration: 100 });
    const reporter = createInMemoryFinalResultReporter();
    const provider = testRunSessionProviderFactory({ execute, reporter });
    const session = provider.createTestRunSession(42, 21);

    await session.runSingleTestCase({ title: 'foo', testFunction: noop, suiteTitle: 'bar' }, 0);

    assert.equal(reporter.getRecordedEntries(), []);
});

test('runSingleTestCase() updates the current test-run result when multiple tests are executed and sends it to the reporter when it is a real-time reporter', async () => {
    const execute = sinon
        .stub()
        .onFirstCall()
        .returns({ status: 'success', duration: 100 })
        .onSecondCall()
        .returns({ status: 'failure', duration: 50 });
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ execute, reporter });
    const session = provider.createTestRunSession(42, 2);

    await session.runSingleTestCase({ title: 'foo', testFunction: noop, suiteTitle: 'suite1' }, 0);
    await session.runSingleTestCase({ title: 'bar', testFunction: noop, suiteTitle: 'suite2' }, 1);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'progress',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 0, successCount: 1, totalCount: 2, completedCount: 1, pendingCount: 1 },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'suite1' },
                        result: { status: 'success', duration: 100 },
                    },
                ],
            },
            testCaseResult: {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'suite1' },
                result: { status: 'success', duration: 100 },
            },
        },
        {
            sessionId: 42,
            type: 'progress',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 1, successCount: 1, totalCount: 2, completedCount: 2, pendingCount: 0 },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'suite1' },
                        result: { status: 'success', duration: 100 },
                    },
                    {
                        testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'suite2' },
                        result: { status: 'failure', duration: 50 },
                    },
                ],
            },
            testCaseResult: {
                testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'suite2' },
                result: { status: 'failure', duration: 50 },
            },
        },
    ]);
});

test('start() reports the initial test-run result to the current reporter when it is a real-time reporter', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ reporter });
    const session = provider.createTestRunSession(42, 21);

    await session.start();

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'start',
            testRunResult: {
                progress: 'pending',
                summary: {
                    failedCount: 0,
                    successCount: 0,
                    totalCount: 21,
                    completedCount: 0,
                    pendingCount: 21,
                },
                testCaseResults: [],
            },
        },
    ]);
});

test('start() doesn’t report anything to the current reporter when it is NOT a real-time reporter', async () => {
    const reporter = createInMemoryFinalResultReporter();
    const provider = testRunSessionProviderFactory({ reporter });
    const session = provider.createTestRunSession(42, 21);

    await session.start();

    assert.equal(reporter.getRecordedEntries(), []);
});

test('done() returns the aggregated result of all given test cases', async () => {
    const provider = testRunSessionProviderFactory();
    const session = provider.createTestRunSession(42, 2);

    const finalResult = await session.done([
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
            result: { status: 'success', duration: 20 },
        },
        {
            testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
            result: { status: 'failure', reason: 'any-reason', duration: 40 },
        },
    ]);

    assert.equal(finalResult, {
        progress: 'completed',
        summary: {
            totalCount: 2,
            failedCount: 1,
            successCount: 1,
            completedCount: 2,
            pendingCount: 0,
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'success', duration: 20 },
            },
            {
                testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                result: { status: 'failure', reason: 'any-reason', duration: 40 },
            },
        ],
    });
});

test('done() reports the aggregated result the the current reporter when it is a real-time reporter', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ reporter });
    const session = provider.createTestRunSession(42, 2);

    await session.done([
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
            result: { status: 'success', duration: 20 },
        },
        {
            testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
            result: { status: 'failure', reason: 'any-reason', duration: 40 },
        },
    ]);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'done',
            testRunResult: {
                progress: 'completed',
                summary: {
                    totalCount: 2,
                    failedCount: 1,
                    successCount: 1,
                    completedCount: 2,
                    pendingCount: 0,
                },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                        result: { status: 'success', duration: 20 },
                    },
                    {
                        testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                        result: { status: 'failure', reason: 'any-reason', duration: 40 },
                    },
                ],
            },
        },
    ]);
});

test('done() reports the aggregated result the the current reporter when it is NOT a real-time reporter', async () => {
    const reporter = createInMemoryFinalResultReporter();
    const provider = testRunSessionProviderFactory({ reporter });
    const session = provider.createTestRunSession(42, 2);

    await session.done([
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
            result: { status: 'success', duration: 20 },
        },
        {
            testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
            result: { status: 'failure', reason: 'any-reason', duration: 40 },
        },
    ]);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'done',
            testRunResult: {
                progress: 'completed',
                summary: {
                    totalCount: 2,
                    failedCount: 1,
                    successCount: 1,
                    completedCount: 2,
                    pendingCount: 0,
                },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                        result: { status: 'success', duration: 20 },
                    },
                    {
                        testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                        result: { status: 'failure', reason: 'any-reason', duration: 40 },
                    },
                ],
            },
        },
    ]);
});

test('multiple messages are sent to the real-time reporter', async () => {
    const execute = sinon.fake.returns({ status: 'success', duration: 100 });
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ execute, reporter });
    const session = provider.createTestRunSession(42, 21);

    await session.start();
    await session.runSingleTestCase({ title: 'foo', testFunction: noop, suiteTitle: 'the-suite' }, 0);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 42,
            type: 'start',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 0, successCount: 0, totalCount: 21, completedCount: 0, pendingCount: 21 },
                testCaseResults: [],
            },
        },
        {
            sessionId: 42,
            type: 'progress',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 0, successCount: 1, totalCount: 21, completedCount: 1, pendingCount: 20 },
                testCaseResults: [
                    {
                        testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                        result: { status: 'success', duration: 100 },
                    },
                ],
            },
            testCaseResult: {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'success', duration: 100 },
            },
        },
    ]);
});

test('multiple messages are sent to the reporter but separated by session when running multiple sessions', async () => {
    const reporter = createInMemoryRealTimeReporter();
    const provider = testRunSessionProviderFactory({ reporter });
    const firstSession = provider.createTestRunSession(1, 21);
    const secondSession = provider.createTestRunSession(2, 21);

    await Promise.all([firstSession.start(), secondSession.start()]);

    assert.equal(reporter.getRecordedEntries(), [
        {
            sessionId: 1,
            type: 'start',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 0, successCount: 0, totalCount: 21, completedCount: 0, pendingCount: 21 },
                testCaseResults: [],
            },
        },
        {
            sessionId: 2,
            type: 'start',
            testRunResult: {
                progress: 'pending',
                summary: { failedCount: 0, successCount: 0, totalCount: 21, completedCount: 0, pendingCount: 21 },
                testCaseResults: [],
            },
        },
    ]);
});

test.run();
