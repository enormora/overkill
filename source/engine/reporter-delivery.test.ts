import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryFinalResultReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import type { FinalResultReporter, RealTimeReporter } from './reporter.ts';
import type { RunResult, RunnerError } from './run-result.ts';
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
                    title: 'passes'
                })
            ],
            metadata: {},
            title: 'root'
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

type FinalPhaseReporterFixture = {
    readonly finalObserver: InMemoryFinalResultReporter;
    readonly finishObserver: InMemoryRealTimeReporter;
    readonly readFailingFinalInput: () => RunResult | null;
    readonly readFailingFinishInput: () => RunResult | null;
    readonly reporters: readonly (FinalResultReporter | RealTimeReporter)[];
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

function recordedFinishResult(reporter: InMemoryRealTimeReporter): RunResult | null {
    const finishEntry = reporter.getRecordedEntries().find(function isFinish(entry) {
        return entry.type === 'finish';
    });

    return finishEntry?.result ?? null;
}

function firstRecordedResult(reporter: InMemoryFinalResultReporter): RunResult | null {
    return reporter.getRecordedEntries()[0]?.result ?? null;
}

function resultRunnerErrorMessages(result: RunResult): readonly string[] {
    return result.runnerErrors.map(function toMessage(error) {
        return error.message;
    });
}

function assertEmptyRunnerErrors(scope: OverkillScope, result: RunResult | null): void {
    scope.require.defined(result);
    scope.assert.deepEqual(result.runnerErrors, []);
}

function createFinalPhaseReporterFixture(): FinalPhaseReporterFixture {
    const finalObserver = createInMemoryFinalResultReporter();
    const finishObserver = createInMemoryRealTimeReporter();
    let failingFinalInput: RunResult | null = null;
    let failingFinishInput: RunResult | null = null;
    const failingFinalReporter: FinalResultReporter = {
        dispose: null,
        kind: 'final-result',
        name: 'final-broken',
        onResult(result) {
            failingFinalInput = result;
            throw new Error('cannot write final output');
        },
        sinks: []
    };
    const failingFinishReporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'finish-broken',
        onEvent() {
            return undefined;
        },
        onFinish(result) {
            failingFinishInput = result;
            throw new Error('cannot write finish output');
        },
        sinks: []
    };

    return {
        finalObserver,
        finishObserver,
        readFailingFinalInput() {
            return failingFinalInput;
        },
        readFailingFinishInput() {
            return failingFinishInput;
        },
        reporters: [ finalObserver, finishObserver, failingFinalReporter, failingFinishReporter ]
    };
}

function assertFinalPhaseCallbackInputsUnchanged(
    scope: OverkillScope,
    fixture: FinalPhaseReporterFixture
): void {
    assertEmptyRunnerErrors(scope, firstRecordedResult(fixture.finalObserver));
    assertEmptyRunnerErrors(scope, recordedFinishResult(fixture.finishObserver));
    assertEmptyRunnerErrors(scope, fixture.readFailingFinalInput());
    assertEmptyRunnerErrors(scope, fixture.readFailingFinishInput());
}

function assertFinalPhaseErrorsReturnedAndNotified(
    scope: OverkillScope,
    fixture: FinalPhaseReporterFixture,
    result: RunResult
): void {
    const expectedMessages = [
        'final-broken: cannot write final output',
        'finish-broken: cannot write finish output'
    ];

    scope.assert.deepEqual(resultRunnerErrorMessages(result), expectedMessages);
    scope.assert.deepEqual(runnerErrorMessages(fixture.finishObserver), expectedMessages);
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

export const testSuite = createOverkillSuite({
    title: 'source/engine/reporter-delivery.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'execute() records reporter callback failures and notifies other real-time reporters',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
                const observer = createInMemoryRealTimeReporter();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken',
                    onEvent(event): Promise<undefined> | undefined {
                        if (event.kind === 'test-start') {
                            throw new Error('cannot render');
                        }

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

                const reporterError = firstRunnerError(result);

                scope.assert.equal(reporterError.message, 'broken: cannot render');
                scope.assert.equal(reporterError.subtype, 'reporter');
                scope.assert.deepEqual(runnerErrorMessages(observer), [ 'broken: cannot render' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() does not recurse when a reporter fails while handling runner-error',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ failingReporter, runnerErrorFailingReporter, observer ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'broken: primary failure', 'also-broken: nested failure' ]
                );
                scope.assert.deepEqual(runnerErrorMessages(observer), [ 'broken: primary failure' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() isolates reporter callback timeouts',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const testStartSignal = createReporterSignal();
                const wallClock = createDeterministicWallClock();
                const engine = createReporterDeliveryEngine(wallClock);
                const hangingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'slow',
                    async onEvent(event): Promise<undefined> {
                        if (event.kind === 'test-start') {
                            testStartSignal.notify();
                            await Promise.race<never>([]);
                        }

                        return undefined;
                    },
                    onFinish: null,
                    sinks: []
                };

                const execution = engine.execute(createPassingPlan(engine), {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ hangingReporter, createInMemoryRealTimeReporter() ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                await testStartSignal.promise;
                await Promise.resolve();
                wallClock.advanceByMilliseconds(100);

                scope.assert.match(
                    firstRunnerError(await execution).message,
                    /slow: slow reporter callback timed out after 100 ms\./
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() records final reporter errors and emits them after real-time finish',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ observer, failingFinalReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'final-broken: cannot finalize' ]
                );
                scope.assert.deepEqual(runnerErrorMessages(observer), [ 'final-broken: cannot finalize' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() returns final-phase reporter errors without changing sibling callback input',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
                const fixture = createFinalPhaseReporterFixture();

                const result = await engine.execute(createPassingPlan(engine), {
                    execution: { mode: 'serial-in-process' },
                    reporters: fixture.reporters,
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                assertFinalPhaseCallbackInputsUnchanged(scope, fixture);
                assertFinalPhaseErrorsReturnedAndNotified(scope, fixture, result);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() disposes reporters once after final reporting',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ reporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(calls, [ 'run-start', 'run-end', 'finish', 'dispose' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() records dispose failures in the returned result',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const engine = createDefaultReporterDeliveryEngine();
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
                    execution: { mode: 'serial-in-process' },
                    reporters: [ failingReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(
                    result.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'dirty: cannot cleanup' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
