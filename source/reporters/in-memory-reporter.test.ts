import assert from 'node:assert/strict';
import type { RunResult } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    createInMemoryReporter
} from './in-memory-reporter.ts';

registerTest('in-memory real-time reporter records events and final result notification', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const runResult: RunResult = runResultFactory.build();
    const event = {
        facts: {},
        kind: 'run-start',
        startedAt: '2026-07-15T00:00:00.000Z'
    } as const;
    const { onFinish } = reporter;

    if (onFinish === null) {
        throw new TypeError('Expected in-memory reporter to expose onFinish.');
    }

    await reporter.onEvent(event);
    await onFinish(runResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [
        { event, result: null, type: 'event' },
        { event: null, result: runResult, type: 'finish' }
    ]);
});

registerTest('in-memory final-result reporter records final results', async function () {
    const reporter = createInMemoryFinalResultReporter();
    const runResult: RunResult = runResultFactory.build();

    await reporter.onResult(runResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { event: null, result: runResult, type: 'result' } ]);
});

registerTest('in-memory configurable reporter creates a real-time reporter', async function () {
    const reporter = createInMemoryReporter({ mode: 'real-time' });
    const event = {
        facts: {},
        kind: 'run-start',
        startedAt: '2026-07-15T00:00:00.000Z'
    } as const;

    await reporter.onEvent(event);

    assert.equal(reporter.kind, 'real-time');
    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { event, result: null, type: 'event' } ]);
});

registerTest('in-memory configurable reporter creates a final-result reporter', async function () {
    const reporter = createInMemoryReporter({ mode: 'final-result' });
    const runResult: RunResult = runResultFactory.build();

    await reporter.onResult(runResult);

    assert.equal(reporter.kind, 'final-result');
    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { event: null, result: runResult, type: 'result' } ]);
});
