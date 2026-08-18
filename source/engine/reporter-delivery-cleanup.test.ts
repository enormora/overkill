import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryFinalResultReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher, type ReporterDispatcher } from './reporter-dispatcher.ts';
import type { FinalResultReporter, RealTimeReporter } from './reporter.ts';
import type { RunResult } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

function createPassingPlan(engine: Engine): TestPlan {
    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
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

type ReporterDeliveryFixture = {
    readonly disposeSignal: ReporterSignal;
    readonly engine: Engine;
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

function runnerErrorMessages(reporter: InMemoryRealTimeReporter): readonly string[] {
    return reporter.getRecordedEntries().flatMap(function toRunnerError(entry) {
        if (entry.event?.kind === 'runner-error') {
            return [ entry.event.error.message ];
        }

        return [];
    });
}

function resultRunnerErrorMessages(result: RunResult): readonly string[] {
    return result.runnerErrors.map(function toMessage(error) {
        return error.message;
    });
}

function recordedFinishResult(reporter: InMemoryRealTimeReporter): RunResult | null {
    const finishEntry = reporter.getRecordedEntries().find(function isFinish(entry) {
        return entry.type === 'finish';
    });

    return finishEntry?.result ?? null;
}

function firstRecordedResult(reporter: InMemoryFinalResultReporter): RunResult | null {
    return reporter.getRecordedEntries()[0]?.result ?? null;
}

function createRunEndFailingReporter(): RealTimeReporter {
    return {
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
}

function assertRunEndErrorResult(scope: OverkillScope, result: RunResult | null): void {
    scope.require.defined(result);
    scope.assert.deepEqual(resultRunnerErrorMessages(result), [ 'run-end-broken: cannot close run' ]);
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
        return null;
    } catch (error: unknown) {
        return error;
    }
}

function ignoreOutputLine(): void {
    return undefined;
}

function createReporterDeliveryEngine(wallClock: ReturnType<typeof createDeterministicWallClock>): Engine {
    return createEngine({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: ignoreOutputLine },
                stdout: { writeLine: ignoreOutputLine },
                wallClock
            }),
            wallClock
        }),
        nodeVersion: '26.0.0',
        readExitCode() {
            return process.exitCode;
        },
        wallClock,
        writeExitCode(exitCode) {
            process.exitCode = exitCode;
        }
    });
}

function createDefaultReporterDeliveryEngine(): Engine {
    return createReporterDeliveryEngine(createDeterministicWallClock());
}

function createReporterDeliveryFixture(): ReporterDeliveryFixture {
    const disposeSignal = createReporterSignal();
    const wallClock = createDeterministicWallClock();
    const engine = createReporterDeliveryEngine(wallClock);

    return { disposeSignal, engine, wallClock };
}

function createConcurrentFinishFixture(): ConcurrentFinishFixture {
    const finishStarted = createReporterSignal();
    const finalReported = createReporterSignal();
    const wallClock = createDeterministicWallClock();
    const engine = createReporterDeliveryEngine(wallClock);

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

export const testSuite = createOverkillSuite({
    name: 'source/engine/reporter-delivery-cleanup.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() times out reporter disposal',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const { disposeSignal, engine, wallClock } = createReporterDeliveryFixture();
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ hangingReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                await disposeSignal.promise;
                await Promise.resolve();
                wallClock.advanceByMilliseconds(100);
                const result = await execution;

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'slow-cleanup: slow-cleanup reporter callback timed out after 100 ms.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() disposes reporters after validation failure',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    sinks: [ { kind: 'stdout-raw' } ]
                };
                const secondReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'second',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { kind: 'stdout-raw' } ]
                };

                await scope.assert.rejects(async function executeWithInvalidReporterSinks() {
                    await engine.execute(createPassingPlan(engine), {
                        execution: { mode: 'serial-in-process' },
                        reporters: [ firstReporter, secondReporter ],
                        runFacts: {},
                        startedAt: '2026-07-15T00:00:00.000Z'
                    });
                }, { message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.' });
                scope.assert.equal(disposed, true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() throws AggregateError when execution and cleanup both fail',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    sinks: [ { kind: 'stdout-raw' } ]
                };
                const secondReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'second',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { kind: 'stdout-raw' } ]
                };

                const execution = engine.execute(createPassingPlan(engine), {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ firstReporter, secondReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                await scope.assert.rejects(async function executeWithInvalidReporterSinksAndFailedCleanup() {
                    await execution;
                }, { message: 'Execution failed and reporter cleanup failed.' });
                const capturedError = await rejectedValue(execution);
                scope.require.instanceOf(capturedError, AggregateError);
                scope.assert.deepEqual(
                    capturedError.errors.map(aggregateErrorEntryMessage),
                    [
                        'Reporter sink conflict: stdout is claimed by incompatible reporters.',
                        'first: cleanup failed'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() does not retry disposal after disposal throws',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
                const wallClock = createDeterministicWallClock();
                let disposeCalls = 0;
                const reporterDispatcher: ReporterDispatcher = {
                    async disposeReporters() {
                        disposeCalls += 1;

                        throw new Error('disposal transport failed');
                    },
                    async reportEvent() {
                        return [];
                    },
                    async reportResult() {
                        return [];
                    }
                };
                const execute = createExecute({ reporterDispatcher, wallClock });

                await scope.assert.rejects(async function executeWithThrowingDisposal() {
                    await execute(createPassingPlan(engine), {
                        execution: { mode: 'serial-in-process' },
                        reporters: [],
                        runFacts: {},
                        startedAt: '2026-07-15T00:00:00.000Z'
                    });
                }, { message: 'disposal transport failed' });
                scope.assert.equal(disposeCalls, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() includes run-end reporter errors before final reporting',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
                const finalReporter = createInMemoryFinalResultReporter();
                const finishReporter = createInMemoryRealTimeReporter();

                const result = await engine.execute(createPassingPlan(engine), {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ createRunEndFailingReporter(), finalReporter, finishReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                assertRunEndErrorResult(scope, result);
                assertRunEndErrorResult(scope, firstRecordedResult(finalReporter));
                assertRunEndErrorResult(scope, recordedFinishResult(finishReporter));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() records dispose failures without reporter re-entry',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
                const observer = createInMemoryRealTimeReporter();
                const failingReporter: RealTimeReporter = {
                    dispose() {
                        throw new Error('cannot release resources');
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ failingReporter, observer ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'dirty: cannot release resources' ]
                );
                scope.assert.deepEqual(runnerErrorMessages(observer), []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() preserves concurrent final-result and real-time finish callbacks',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const fixture = createConcurrentFinishFixture();

                const execution = fixture.engine.execute(createPassingPlan(fixture.engine), {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ fixture.realTimeReporter, fixture.finalReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                await fixture.finishStarted.promise;
                await fixture.finalReported.promise;
                await Promise.resolve();
                fixture.wallClock.advanceByMilliseconds(100);
                const result = await execution;

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'slow-finish: slow-finish reporter callback timed out after 100 ms.' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
