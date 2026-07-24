import assert from 'node:assert/strict';
import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { registerTest } from '../test-support/register-test.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher, type FinalResultReporter, type RealTimeReporter } from './reporter.ts';
import type { RunResult, RunnerError } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

function createPassingPlan(engine: Engine): TestPlan {
    return engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.ok(true, 'passes');
                        return testContext.assert.done();
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

type ReporterSignal = {
    readonly notify: () => void;
    readonly promise: Promise<void>;
};

type AggregateErrorEntryWithMessage = {
    readonly message: unknown;
};

type ConcurrentFinishFixture = {
    readonly engine: Engine;
    readonly finalReported: ReporterSignal;
    readonly finalReporter: FinalResultReporter;
    readonly finishStarted: ReporterSignal;
    readonly realTimeReporter: RealTimeReporter;
    readonly wallClock: ReturnType<typeof createDeterministicWallClock>;
};

function createReporterSignal(): ReporterSignal {
    let notify: () => void = function notifyUnsetSignal(): void {
        return undefined;
    };
    const promise = new Promise<void>(function resolveOnNotify(resolve) {
        notify = resolve;
    });

    return { notify, promise };
}

function hasMessage(value: unknown): value is AggregateErrorEntryWithMessage {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'message');
}

function aggregateErrorEntryMessage(entry: unknown): string {
    if (hasMessage(entry)) {
        return String(entry.message);
    }

    return entry instanceof Error ? entry.message : String(entry);
}

function createConcurrentFinishFixture(): ConcurrentFinishFixture {
    const finishStarted = createReporterSignal();
    const finalReported = createReporterSignal();
    const wallClock = createDeterministicWallClock();
    const engine = createEngine({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({ wallClock }),
            wallClock
        })
    });

    return {
        engine,
        finalReported,
        finalReporter: {
            dispose: null,
            kind: 'final-result',
            name: 'final',
            onResult() {
                finalReported.notify();
            },
            sinks: []
        },
        finishStarted,
        realTimeReporter: {
            dispose: null,
            kind: 'real-time',
            name: 'slow-finish',
            onEvent() {
                return undefined;
            },
            async onFinish() {
                finishStarted.notify();

                return await Promise.race<never>([]);
            },
            sinks: []
        },
        wallClock
    };
}

registerTest('execute() records reporter callback failures and notifies other real-time reporters', async function () {
    const engine = createTestEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingReporter: RealTimeReporter = {
        dispose: null,
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
    const engine = createTestEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingReporter: RealTimeReporter = {
        dispose: null,
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
        dispose: null,
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
    const testStartSignal = createReporterSignal();
    const wallClock = createDeterministicWallClock();
    const engine = createEngine({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({ wallClock }),
            wallClock
        })
    });
    const hangingReporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'slow',
        onEvent(event): Promise<void> | void {
            if (event.kind === 'test-start') {
                testStartSignal.notify();
                return Promise.race<never>([]);
            }

            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const execution = engine.execute(createPassingPlan(engine), {
        reporters: [ hangingReporter, createInMemoryRealTimeReporter() ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    await testStartSignal.promise;
    await Promise.resolve();
    wallClock.advanceByMilliseconds(100);
    const reporterError = firstRunnerError(await execution);

    assert.match(reporterError.message, /slow: slow reporter callback timed out after 100 ms\./);
});

registerTest('execute() records final reporter errors and emits them after real-time finish', async function () {
    const engine = createTestEngine();
    const observer = createInMemoryRealTimeReporter();
    const failingFinalReporter: FinalResultReporter = {
        dispose: null,
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

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'final-broken: cannot finalize' ]
    );
    assert.deepStrictEqual(runnerErrorMessages(observer), [ 'final-broken: cannot finalize' ]);
});

registerTest('execute() disposes reporters once after final reporting', async function () {
    const engine = createTestEngine();
    const calls: string[] = [];
    const reporter: RealTimeReporter = {
        dispose() {
            calls.push('dispose');
        },
        kind: 'real-time',
        name: 'cleanup',
        onEvent(event) {
            if (event.kind === 'run-start') {
                calls.push('run-start');
            } else if (event.kind === 'run-end') {
                calls.push('run-end');
            }
        },
        onFinish() {
            calls.push('finish');
        },
        sinks: []
    };

    await engine.execute(createPassingPlan(engine), {
        reporters: [ reporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(calls, [ 'run-start', 'run-end', 'finish', 'dispose' ]);
});

registerTest('execute() records dispose failures in the returned result', async function () {
    const engine = createTestEngine();
    const failingReporter: RealTimeReporter = {
        dispose() {
            throw new Error('cannot cleanup');
        },
        kind: 'real-time',
        name: 'dirty',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ failingReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'dirty: cannot cleanup' ]
    );
});

registerTest('execute() times out reporter disposal', async function () {
    const disposeSignal = createReporterSignal();
    const wallClock = createDeterministicWallClock();
    const engine = createEngine({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({ wallClock }),
            wallClock
        })
    });
    const hangingReporter: RealTimeReporter = {
        async dispose() {
            disposeSignal.notify();

            return await Promise.race<never>([]);
        },
        kind: 'real-time',
        name: 'slow-cleanup',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: []
    };

    const execution = engine.execute(createPassingPlan(engine), {
        reporters: [ hangingReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    await disposeSignal.promise;
    await Promise.resolve();
    wallClock.advanceByMilliseconds(100);
    const result = await execution;

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'slow-cleanup: slow-cleanup reporter callback timed out after 100 ms.' ]
    );
});

registerTest('execute() disposes reporters after validation failure', async function () {
    const engine = createTestEngine();
    let disposed = false;
    const firstReporter: RealTimeReporter = {
        dispose() {
            disposed = true;
        },
        kind: 'real-time',
        name: 'first',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ]
    };
    const secondReporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'second',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ]
    };

    await assert.rejects(
        async function executeWithInvalidReporterSinks() {
            await engine.execute(createPassingPlan(engine), {
                reporters: [ firstReporter, secondReporter ],
                runFacts: {},
                startedAt: '2026-07-15T00:00:00.000Z'
            });
        },
        { message: 'Reporter sink conflict: stdout is claimed exclusively.' }
    );
    assert.equal(disposed, true);
});

registerTest('execute() throws AggregateError when execution and cleanup both fail', async function () {
    const engine = createTestEngine();
    const firstReporter: RealTimeReporter = {
        dispose() {
            throw new Error('cleanup failed');
        },
        kind: 'real-time',
        name: 'first',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ]
    };
    const secondReporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'second',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ]
    };

    await assert.rejects(
        async function executeWithInvalidReporterSinksAndFailedCleanup() {
            await engine.execute(createPassingPlan(engine), {
                reporters: [ firstReporter, secondReporter ],
                runFacts: {},
                startedAt: '2026-07-15T00:00:00.000Z'
            });
        },
        function isAggregateError(error: unknown) {
            assert.equal(error instanceof AggregateError, true);
            const aggregateError = error as AggregateError;
            assert.deepStrictEqual(
                aggregateError.errors.map(aggregateErrorEntryMessage),
                [
                    'Reporter sink conflict: stdout is claimed exclusively.',
                    'first: cleanup failed'
                ]
            );

            return true;
        }
    );
});

registerTest('execute() includes run-end reporter errors before final reporting', async function () {
    const engine = createTestEngine();
    const finalReporter = createInMemoryFinalResultReporter();
    const failingReporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'run-end-broken',
        onEvent(event) {
            if (event.kind === 'run-end') {
                throw new Error('cannot close run');
            }
        },
        onFinish: null,
        sinks: []
    };

    const result = await engine.execute(createPassingPlan(engine), {
        reporters: [ failingReporter, finalReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    const reportedResult = finalReporter.getRecordedEntries()[0]?.result;

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'run-end-broken: cannot close run' ]
    );
    assert.deepStrictEqual(
        reportedResult?.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'run-end-broken: cannot close run' ]
    );
});

registerTest('execute() preserves concurrent final-result and real-time finish callbacks', async function () {
    const fixture = createConcurrentFinishFixture();

    const execution = fixture.engine.execute(createPassingPlan(fixture.engine), {
        reporters: [ fixture.realTimeReporter, fixture.finalReporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    await fixture.finishStarted.promise;
    await fixture.finalReported.promise;
    await Promise.resolve();
    fixture.wallClock.advanceByMilliseconds(100);
    const result = await execution;

    assert.deepStrictEqual(
        result.runnerErrors.map(function toMessage(error) {
            return error.message;
        }),
        [ 'slow-finish: slow-finish reporter callback timed out after 100 ms.' ]
    );
});
