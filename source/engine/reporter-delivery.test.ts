import assert from 'node:assert/strict';
import { createInMemoryRealTimeReporter, type InMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { registerTest } from '../test-support/register-test.ts';
import { createEngine, type Engine } from './engine.ts';
import type { FinalResultReporter, RealTimeReporter } from './reporter.ts';
import type { RunResult, RunnerError } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

function createPassingPlan(engine: Engine): TestPlan {
    return engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        return testContext.assert.ok(true, 'passes');
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
}

function runnerErrorMessages(reporter: InMemoryRealTimeReporter): readonly string[] {
    return reporter.getRecordedEntries().flatMap(function toRunnerError(entry) {
        if (entry.event?.kind === 'runner-error') {
            return [ entry.event.error.message ];
        }

        return [];
    });
}

function firstRunnerError(result: RunResult): RunnerError {
    const reporterError = result.runnerErrors[0];
    if (reporterError === undefined) {
        throw new TypeError('Expected one reporter error.');
    }

    return reporterError;
}

registerTest('execute() records reporter callback failures and notifies other real-time reporters', async function () {
    const engine = createEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingReporter: RealTimeReporter = {
        kind: 'real-time',
        name: 'broken',
        onEvent(event) {
            if (event.kind === 'test-start') {
                throw new Error('cannot render');
            }

            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ failingReporter, observer ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    const reporterError = firstRunnerError(result);

    assert.equal(reporterError.message, 'broken: cannot render');
    assert.equal(reporterError.subtype, 'reporter');
    assert.deepStrictEqual(runnerErrorMessages(observer), [ 'broken: cannot render' ]);
});

registerTest('execute() does not recurse when a reporter fails while handling runner-error', async function () {
    const engine = createEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingReporter: RealTimeReporter = {
        kind: 'real-time',
        name: 'broken',
        onEvent(event) {
            if (event.kind === 'test-start') {
                throw new Error('primary failure');
            }

            return undefined;
        },
        onFinish: null,
        sinks: []
    };
    const runnerErrorFailingReporter: RealTimeReporter = {
        kind: 'real-time',
        name: 'also-broken',
        onEvent(event) {
            if (event.kind === 'runner-error') {
                throw new Error('nested failure');
            }

            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ failingReporter, runnerErrorFailingReporter, observer ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'broken: primary failure', 'also-broken: nested failure' ]
    );
    assert.deepStrictEqual(runnerErrorMessages(observer), [ 'broken: primary failure' ]);
});

registerTest('execute() isolates reporter callback timeouts', async function () {
    const engine = createEngine();
    const hangingReporter: RealTimeReporter = {
        kind: 'real-time',
        name: 'slow',
        onEvent(event): Promise<void> | void {
            if (event.kind === 'test-start') {
                return Promise.race<never>([]);
            }

            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ hangingReporter, createInMemoryRealTimeReporter() ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.equal(result.runnerErrors.length, 1);
    assert.match(result.runnerErrors[0]?.message ?? '', /slow: slow reporter callback timed out after 100 ms\./);
});

registerTest('execute() emits late reporter errors without mutating the returned result', async function () {
    const engine = createEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingFinalReporter: FinalResultReporter = {
        kind: 'final-result',
        name: 'final-broken',
        onResult() {
            throw new Error('cannot finalize');
        },
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ observer, failingFinalReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(result.runnerErrors, []);
    assert.deepStrictEqual(runnerErrorMessages(observer), [ 'final-broken: cannot finalize' ]);
});
