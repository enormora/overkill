import { createDeterministicClock } from '@enormora/clock';
import {
    createSuite,
    createTestCase,
    defineReporter,
    type ReporterEvent,
    type DefinedReporter,
    type TestPlan,
    type RunResult,
    type TestBody,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute, type ExecuteOptions } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { CaseRunnerError } from './run-result.ts';
import { testNode as retryPromiseAttributionTestNode } from './retry-promise-attribution.test.ts';
import { testNode as retryAdmissionTestNode } from './retry-admission.test.ts';

const options: ExecuteOptions = {
    execution: { mode: 'serial-in-process' },
    reporters: [],
    retryPolicy: { maxAttempts: 3 },
    runFacts: {},
    startedAt: '1970-01-01T00:00:00.000Z'
};

const schedulingCases = [
    { mode: 'serial-in-process' },
    { mode: 'concurrent-in-process', maxConcurrency: 1 }
] as const;

type RetryProbe = {
    readonly runs: () => number;
    readonly signals: () => readonly AbortSignal[];
    readonly cleanup: () => readonly number[];
    readonly events: () => readonly ReporterEvent[];
    readonly body: TestBody;
    readonly reporter: DefinedReporter;
};

async function executeBody(body: TestBody, executionOptions: ExecuteOptions): Promise<RunResult> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'retry',
        children: [ engine.createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'case',
            body
        }) ]
    }));
    return await engine.execute(plan, executionOptions);
}

function retryPlan(engine: Engine, body: TestBody): TestPlan {
    return engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'retry',
        children: [
            engine.createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'case',
                body
            })
        ]
    }));
}

function recordingReporter(record: (event: ReporterEvent) => void): DefinedReporter {
    return defineReporter(function () {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'retry-events',
            sinks: [ { kind: 'memory' } ],
            onFinish: null,
            onEvent: record
        };
    });
}

function createRetryProbe(): RetryProbe {
    let runs = 0;
    const signals: AbortSignal[] = [];
    const cleanup: number[] = [];
    const events: ReporterEvent[] = [];
    return {
        runs() {
            return runs;
        },
        signals() {
            return signals;
        },
        cleanup() {
            return cleanup;
        },
        events() {
            return events;
        },
        reporter: recordingReporter(function recordEvent(event) {
            events.push(event);
        }),
        body(attemptScope) {
            runs += 1;
            const run = runs;
            signals.push(attemptScope.signal);
            attemptScope.plan(1);
            attemptScope.cleanup(function () {
                cleanup.push(run);
            });
            attemptScope.assert.equal(runs, 2);
            return attemptScope.assert.collect();
        }
    };
}

function assertRecoveredCase(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(result.summary.failed, 0);
    scope.assert.equal(result.perTest.length, 1);
    const first = result.perTest[0];
    scope.require.defined(first);
    scope.require.defined(first.retried);
    scope.assert.deepEqual(first.retried, { attempts: 2, finalVerdict: 'pass' });
    scope.assert.deepEqual(
        first.attempts.map(function attemptResult(attempt) {
            return [ attempt.attempt.index, attempt.verdict ];
        }),
        [ [ 0, 'fail' ], [ 1, 'pass' ] ]
    );
}

function assertRetryProbe(scope: TestScope, probe: RetryProbe): void {
    scope.assert.equal(probe.runs(), 2);
    scope.assert.deepEqual(probe.cleanup(), [ 1, 2 ]);
    scope.assert.notEqual(probe.signals()[0], probe.signals()[1]);
    scope.assert.true(
        probe.signals().every(function aborted(signal) {
            return signal.aborted;
        })
    );
    scope.assert.deepEqual(
        probe
            .events()
            .filter(function ended(event) {
                return event.kind === 'test-end';
            })
            .map(function completion(event) {
                return [ event.attempt, event.completion ];
            }),
        [ [ 0, 'retry' ], [ 1, 'final' ] ]
    );
}

function deterministicEngine(clock: ReturnType<typeof createDeterministicClock>): Engine {
    return createEngine({
        wallClock: clock,
        execute: createExecute({
            asyncLeakDiagnostics: 'disabled',
            readActiveResourceTypes() {
                return [];
            },
            wallClock: clock,
            reporterDispatcher: createReporterDispatcher({
                stderr: {
                    writeLine() {
                        return undefined;
                    }
                },
                stdout: {
                    writeLine() {
                        return undefined;
                    }
                },
                wallClock: clock
            })
        })
    });
}

function failingCompletionPolicy(completed: () => void): NonNullable<ExecuteOptions['runtimePolicy']> {
    return {
        async runLoad(run) {
            return await run();
        },
        async runAttempt(_testCase, _attempt, run) {
            return await run();
        },
        async completeCase() {
            completed();
            throw new Error('shared cleanup failed');
        },
        takeAttemptErrors() {
            return [];
        },
        takePendingRunErrors() {
            return [];
        },
        takeRunErrors() {
            return [];
        }
    };
}

function assertCompletionFailure(scope: TestScope, result: RunResult): void {
    const first = result.perTest[0];
    scope.require.defined(first);
    const error = result.runnerErrors[0];
    scope.require.defined(error);
    scope.assert.equal(result.summary.runtimePolicy, 1);
    scope.assert.equal(first.outcome, null);
    scope.assert.equal(first.attempts.at(-1)?.outcome?.kind, 'pass');
    scope.assert.equal(first.retried?.finalVerdict, 'runtime-policy');
    scope.assert.equal(error.attributedToAttempt?.index, 1);
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/engine/retry-execution.test.ts',
    children: [
        retryPromiseAttributionTestNode,
        retryAdmissionTestNode,
        ...schedulingCases.map(function retryScheduling(execution) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `retry execution preserves attempts under ${execution.mode}`,
                async body(scope: TestScope) {
                    const probe = createRetryProbe();
                    const result = await executeBody(probe.body, {
                        ...options,
                        execution,
                        reporters: [ probe.reporter ]
                    });
                    assertRecoveredCase(scope, result);
                    assertRetryProbe(scope, probe);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'retries stop at the total attempt limit',
            async body(scope: TestScope) {
                let runs = 0;
                const result = await executeBody(function (attemptScope) {
                    runs += 1;
                    attemptScope.assert.fail();
                    return attemptScope.assert.collect();
                }, options);
                scope.assert.equal(runs, 3);
                scope.assert.equal(result.summary.failed, 1);
                const first = result.perTest[0];
                scope.require.defined(first);
                scope.require.defined(first.retried);
                scope.assert.deepEqual(first.retried, { attempts: 3, finalVerdict: 'fail' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'cooperative soft timeouts reset per attempt after cleanup',
            async body(scope: TestScope) {
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const engine = deterministicEngine(clock);
                const probe = { runs: 0, cleaned: 0 };
                const plan = retryPlan(engine, function (attemptScope) {
                    probe.runs += 1;
                    attemptScope.cleanup(function () {
                        probe.cleaned += 1;
                    });
                    clock.advanceByMilliseconds(probe.runs === 1 ? 5 : 1);
                    attemptScope.assert.true(true);
                    return attemptScope.assert.collect();
                });
                const result = await engine.execute(plan, {
                    ...options,
                    timeoutPolicy: { timeoutMilliseconds: 3, hardTimeoutMilliseconds: 10 }
                });
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(probe.cleaned, 2);
                scope.assert.equal(result.perTest[0]?.attempts.length, 2);
                scope.assert.equal(result.perTest[0]?.durationMicroseconds, 6000);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'explicit non-integration families reject retries before running bodies',
            async body(scope: TestScope) {
                const engine = createTestEngine();
                let runs = 0;
                const plan = retryPlan(engine, function (attemptScope) {
                    runs += 1;
                    attemptScope.assert.true(true);
                    return attemptScope.assert.collect();
                });
                const blocked = { ...plan, cases: [ { ...plan.cases[0], testFamily: 'microtest' as const } ] as const };
                await scope.assert.rejects(async function runNonIntegrationPlan() {
                    await engine.execute(blocked, options);
                }, { message: 'Retries require integration or family-neutral test plans.' });
                scope.assert.equal(runs, 0);
                return scope.assert.collect();
            }
        }),
        ...[ null, { maxAttempts: 1 } ].map(function disabledRetries(retryPolicy) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `retries disabled with ${retryPolicy?.maxAttempts ?? 'no policy'}`,
                async body(scope: TestScope) {
                    let runs = 0;
                    const result = await executeBody(function (attemptScope) {
                        runs += 1;
                        attemptScope.assert.fail();
                        return attemptScope.assert.collect();
                    }, { ...options, retryPolicy });
                    scope.assert.equal(runs, 1);
                    scope.assert.equal(result.perTest[0]?.retried, null);
                    scope.assert.equal(result.perTest[0]?.attempts.length, 1);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'ordinary body errors can recover',
            async body(scope: TestScope) {
                let runs = 0;
                const result = await executeBody(function (attemptScope) {
                    runs += 1;
                    if (runs === 1) {
                        throw new Error('transient');
                    }
                    attemptScope.assert.true(true);
                    return attemptScope.assert.collect();
                }, options);
                scope.assert.equal(result.perTest[0]?.attempts[0].outcome?.kind, 'fail');
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(runs, 2);
                return scope.assert.collect();
            }
        }),
        ...[ 'contract', 'cleanup', 'infrastructure' ].map(function terminalFailure(kind) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${kind} failures are terminal`,
                async body(scope: TestScope) {
                    let runs = 0;
                    const result = await executeBody(function (attemptScope) {
                        runs += 1;
                        if (kind === 'contract') {
                            return attemptScope.assert.collect();
                        }
                        if (kind === 'infrastructure') {
                            throw new CaseRunnerError('fixture failed', { cause: null, subtype: 'fixture' });
                        }
                        attemptScope.cleanup(function () {
                            throw new Error('cleanup failed');
                        });
                        attemptScope.assert.fail();
                        return attemptScope.assert.collect();
                    }, options);
                    scope.assert.equal(runs, 1);
                    scope.assert.equal(result.status, 'failed');
                    scope.assert.equal(result.perTest[0]?.retried, null);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'reporter errors fail the run without stopping retries',
            async body(scope: TestScope) {
                let runs = 0;
                const reporter = defineReporter(function () {
                    return {
                        dispose: null,
                        kind: 'real-time',
                        name: 'broken',
                        sinks: [ { kind: 'memory' } ],
                        onFinish: null,
                        onEvent(event: ReporterEvent) {
                            if (event.kind === 'test-end') {
                                throw new Error('reporter failed');
                            }
                        }
                    };
                });
                const result = await executeBody(function (attemptScope) {
                    runs += 1;
                    attemptScope.assert.equal(runs, 2);
                    return attemptScope.assert.collect();
                }, { ...options, reporters: [ reporter ] });
                scope.assert.equal(runs, 2);
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.status, 'failed');
                scope.assert.true(result.runnerErrors.some(function reporterError(error) {
                    return error.subtype === 'reporter';
                }));
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'logical duration sums every attempt',
            async body(scope: TestScope) {
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const engine = deterministicEngine(clock);
                let runs = 0;
                const plan = engine.createTestPlan(
                    engine.createRoot({
                        annotations: {},
                        controls: {},
                        title: 'duration',
                        children: [ engine.createTestCase({
                            annotations: {},
                            controls: {},
                            definitionLocations: [ { kind: 'unknown' } ],
                            title: 'case',
                            body(attemptScope) {
                                runs += 1;
                                clock.advanceByMilliseconds(5);
                                attemptScope.assert.equal(runs, 2);
                                return attemptScope.assert.collect();
                            }
                        }) ]
                    })
                );
                const result = await engine.execute(plan, options);
                scope.assert.equal(result.perTest[0]?.durationMicroseconds, 10_000);
                const first = result.perTest[0];
                scope.require.defined(first);
                scope.assert.deepEqual(
                    first.attempts.map(function duration(attempt) {
                        return attempt.durationMicroseconds;
                    }),
                    [ 5000, 5000 ]
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'logical completion failure is terminal and preserves the recovered body evidence',
            async body(scope: TestScope) {
                let runs = 0;
                let completed = 0;
                const result = await executeBody(function (attemptScope) {
                    runs += 1;
                    attemptScope.assert.equal(runs, 2);
                    return attemptScope.assert.collect();
                }, {
                    ...options,
                    runtimePolicy: failingCompletionPolicy(function recordCompletion() {
                        completed += 1;
                    })
                });
                scope.assert.deepEqual([ runs, completed ], [ 2, 1 ]);
                assertCompletionFailure(scope, result);
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
