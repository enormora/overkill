import assert from 'node:assert/strict';
import type { RunResult } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { createInMemoryFinalResultReporter, createInMemoryRealTimeReporter } from './in-memory-reporter.ts';

const runResult: RunResult = {
    artifacts: [],
    bySuite: {},
    orphans: [],
    perTest: [],
    runnerErrors: [],
    summary: { defined: 0, discovered: 0, failed: 0, inconclusive: 0, passed: 0, skipped: 0 },
    wallTimeMs: 0
};

registerTest('in-memory real-time reporter records events and final result notification', async function () {
    const reporter = createInMemoryRealTimeReporter();
    const event = {
        attempt: null,
        case: null,
        facts: {},
        kind: 'run-start',
        outcome: null,
        result: null,
        startedAt: '2026-07-15T00:00:00.000Z',
        verdict: null,
        wallTimeMs: null
    } as const;

    await reporter.onEvent(event);
    await reporter.onFinish(runResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [
        { event, result: null, type: 'event' },
        { event: null, result: runResult, type: 'finish' }
    ]);
});

registerTest('in-memory final-result reporter records final results', async function () {
    const reporter = createInMemoryFinalResultReporter();

    await reporter.onResult(runResult);

    assert.deepStrictEqual(reporter.getRecordedEntries(), [ { event: null, result: runResult, type: 'result' } ]);
});
