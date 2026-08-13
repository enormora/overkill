import { defineNarrowingCompositeAssertion } from '@overkill-dev/assert';
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
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { RealTimeReporter, ReporterEvent } from './reporter.ts';
import type { BodyErrorTestFailure, FailOutcome, RunResult, TestFailure, TestOutcome } from './run-result.ts';
import type { TestCase } from './test-node.ts';
import type { TestPlan } from './test-plan.ts';

function recordedEvents(reporter: InMemoryRealTimeReporter): readonly ReporterEvent[] {
    return reporter.getRecordedEntries().flatMap(function toEvent(entry) {
        return entry.event === null ? [] : [ entry.event ];
    });
}

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

const failOutcome = defineNarrowingCompositeAssertion<TestOutcome, FailOutcome, readonly []>({
    name: 'fail outcome',
    narrows(actual): actual is FailOutcome {
        return actual.kind === 'fail';
    }
});

const bodyErrorFailure = defineNarrowingCompositeAssertion<TestFailure, BodyErrorTestFailure, readonly []>({
    name: 'body error failure',
    narrows(actual): actual is BodyErrorTestFailure {
        return actual.kind === 'body-error';
    }
});

function firstOutcome(result: RunResult): TestOutcome | undefined {
    return result.perTest.at(0)?.outcome;
}

type ReporterSignal = {
    readonly notify: () => void;
    readonly promise: Promise<void>;
};

type PlanOrderedConcurrentScenario = {
    readonly events: readonly ReporterEvent[];
    readonly releaseFirst: ReporterSignal;
    readonly reporter: RealTimeReporter;
    readonly secondEnded: ReporterSignal;
    readonly testPlan: TestPlan;
};

type ReporterSerializationScenario = {
    readonly endEntered: ReporterSignal;
    readonly maximumActiveEndReports: () => number;
    readonly releaseEnd: ReporterSignal;
    readonly reporter: RealTimeReporter;
    readonly testPlan: TestPlan;
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

function eventCaseNames(events: readonly ReporterEvent[], kind: 'test-end' | 'test-start'): readonly string[] {
    return events.flatMap(function toMatchingCaseName(event) {
        return event.kind === kind ? [ event.case.name ] : [];
    });
}

function createPassingCase(engine: Engine, name: string): TestCase {
    return engine.createTestCase({
        body(testScope) {
            testScope.assert.true(true, { message: `${name} passes` });
            return testScope.assert.collect();
        },
        metadata: {},
        name
    });
}

function createPlanOrderedConcurrentScenario(engine: Engine): PlanOrderedConcurrentScenario {
    const secondEnded = createReporterSignal();
    const releaseFirst = createReporterSignal();
    const events: ReporterEvent[] = [];
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'observer',
        onEvent(event) {
            events.push(event);

            if (event.kind === 'test-end' && event.case.name === 'second') {
                secondEnded.notify();
            }
        },
        onFinish: null,
        sinks: []
    };
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    async body(testScope) {
                        await releaseFirst.promise;
                        testScope.assert.true(true, { message: 'first passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'first'
                }),
                createPassingCase(engine, 'second')
            ],
            metadata: {},
            name: 'root'
        })
    );

    return { events, releaseFirst, reporter, secondEnded, testPlan };
}

async function executeConcurrentTestPlan(
    engine: Engine,
    testPlan: TestPlan,
    reporter: RealTimeReporter
): Promise<RunResult> {
    return await engine.execute(testPlan, {
        execution: { mode: 'concurrent-in-process' },
        reporters: [ reporter ],
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });
}

function createReporterSerializationScenario(engine: Engine): ReporterSerializationScenario {
    const endEntered = createReporterSignal();
    const releaseEnd = createReporterSignal();
    let activeEndReports = 0;
    let maximumActiveEndReports = 0;
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'observer',
        async onEvent(event) {
            if (event.kind !== 'test-end') {
                return;
            }

            activeEndReports += 1;
            maximumActiveEndReports = Math.max(maximumActiveEndReports, activeEndReports);
            endEntered.notify();
            await releaseEnd.promise;
            activeEndReports -= 1;
        },
        onFinish: null,
        sinks: []
    };
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                createPassingCase(engine, 'first'),
                createPassingCase(engine, 'second')
            ],
            metadata: {},
            name: 'root'
        })
    );

    return {
        endEntered,
        maximumActiveEndReports() {
            return maximumActiveEndReports;
        },
        releaseEnd,
        reporter,
        testPlan
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/execution-reporting.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() records thrown test body errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body() {
                                    throw new Error('boom');
                                },
                                metadata: {},
                                name: 'throws error'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );

                const result = await engine.execute(testPlan);

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                const failure = outcome.failures[0];
                scope.require(bodyErrorFailure, failure);
                scope.assert.deepEqual(
                    {
                        errorMessage: failure.error.message,
                        errorName: failure.error.name,
                        failureKinds: outcome.failures.map(function toFailureKind(recordedFailure) {
                            return recordedFailure.kind;
                        }),
                        failed: result.summary.failed
                    },
                    {
                        errorMessage: 'boom',
                        errorName: 'Error',
                        failureKinds: [ 'body-error' ],
                        failed: 1
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() preserves assertions recorded before a thrown body error',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.equal(1, 2, { message: 'numbers differ' });
                                    throw new Error('boom');
                                },
                                metadata: {},
                                name: 'asserts then throws'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );

                const result = await engine.execute(testPlan);
                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);

                scope.assert.deepEqual(
                    outcome.failures.map(function toFailureKind(failure) {
                        return failure.kind;
                    }),
                    [ 'assertion', 'body-error' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() records rejected test body promises as body errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                async body() {
                                    await Promise.resolve();
                                    throw new Error('rejects');
                                },
                                metadata: {},
                                name: 'rejects'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );

                const result = await engine.execute(testPlan);
                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);

                const failure = outcome.failures[0];
                scope.require(bodyErrorFailure, failure);
                scope.assert.equal(failure.kind, 'body-error');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() delivers events and final results to reporters',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const realTimeReporter = createInMemoryRealTimeReporter();
                const finalResultReporter = createInMemoryFinalResultReporter();
                const testPlan = engine.createTestPlan(
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

                const result = await engine.execute(testPlan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ realTimeReporter, finalResultReporter ],
                    runFacts: { seed: 42 },
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                const eventShape = plainDataShape(recordedEvents(realTimeReporter));

                scope.assert.deepEqual(
                    eventShape,
                    [
                        {
                            facts: { seed: 42 },
                            kind: 'run-start',
                            root: { metadata: {}, name: 'root' },
                            startedAt: '2026-07-15T00:00:00.000Z'
                        },
                        {
                            attempt: 0,
                            case: { file: null, name: 'passes', params: null, suite: [] },
                            kind: 'test-start'
                        },
                        {
                            attempt: 0,
                            case: { file: null, name: 'passes', params: null, suite: [] },
                            kind: 'test-end',
                            outcome: { kind: 'pass' },
                            verdict: 'pass',
                            wallTimeMs: 0
                        },
                        { kind: 'run-end', result }
                    ]
                );
                scope.assert.deepEqual(
                    finalResultReporter.getRecordedEntries(),
                    [ { event: null, result, type: 'result' } ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() emits suite events for table path segments',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const realTimeReporter = createInMemoryRealTimeReporter();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                metadata: {},
                                name: 'first'
                            }),
                            engine.createTable({
                                cases: [
                                    {
                                        body(testScope) {
                                            testScope.assert.true(true, { message: 'row passes' });
                                            return testScope.assert.collect();
                                        },
                                        metadata: {},
                                        name: 'row 1',
                                        parameters: {}
                                    }
                                ],
                                metadata: {},
                                name: 'rows'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );

                await engine.execute(testPlan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ realTimeReporter ],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                const suiteEvents = realTimeReporter.getRecordedEntries().flatMap(function toSuiteEvent(entry) {
                    if (entry.event?.kind === 'suite-start' || entry.event?.kind === 'suite-end') {
                        return [ entry.event ];
                    }

                    return [];
                });

                scope.assert.deepEqual(suiteEvents, [
                    { kind: 'suite-start', suitePath: [ 'rows' ] },
                    { kind: 'suite-end', suitePath: [ 'rows' ] }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects reporter sink conflicts before starting the run',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                let bodyRan = false;
                const realTimeReporter = createInMemoryRealTimeReporter();
                const conflictingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'conflicting',
                    onEvent() {
                        return undefined;
                    },
                    onFinish: null,
                    sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ]
                };
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    bodyRan = true;
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

                await scope.assert.rejects(async function executeWithConflictingReporters() {
                    await engine.execute(testPlan, {
                        execution: { mode: 'serial-in-process' },
                        reporters: [
                            { ...realTimeReporter, sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ] },
                            conflictingReporter
                        ],
                        runFacts: {},
                        startedAt: '2026-07-15T00:00:00.000Z'
                    });
                }, { message: 'Reporter sink conflict: stdout is claimed exclusively.' });
                scope.assert.equal(bodyRan, false);
                scope.assert.deepEqual(realTimeReporter.getRecordedEntries(), []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() runs concurrent in-process cases with plan-ordered starts and results',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const scenario = createPlanOrderedConcurrentScenario(engine);
                const execution = executeConcurrentTestPlan(engine, scenario.testPlan, scenario.reporter);
                await scenario.secondEnded.promise;
                scenario.releaseFirst.notify();
                const result = await execution;

                scope.assert.deepEqual(eventCaseNames(scenario.events, 'test-start'), [ 'first', 'second' ]);
                scope.assert.deepEqual(eventCaseNames(scenario.events, 'test-end'), [ 'second', 'first' ]);
                scope.assert.deepEqual(
                    result.perTest.map(function toCaseName(testResult) {
                        return testResult.id.name;
                    }),
                    [ 'first', 'second' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() serializes reporter callbacks during concurrent execution',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const scenario = createReporterSerializationScenario(engine);
                const execution = executeConcurrentTestPlan(engine, scenario.testPlan, scenario.reporter);
                await scenario.endEntered.promise;
                await Promise.resolve();
                scenario.releaseEnd.notify();
                await execution;

                scope.assert.equal(scenario.maximumActiveEndReports(), 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
