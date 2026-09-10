import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import { resolveRootTestAnnotations, resolveRootTestControls } from './test-data.ts';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from './reporter.ts';
import type {
    BodyErrorTestFailure,
    FailOutcome,
    RunResult,
    TestFailure,
    TestOutcome
} from './run-result.ts';
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

type ReporterConflictExecutionState = {
    readonly bodyRan: () => boolean;
    readonly recordBodyRun: () => void;
    readonly recordReporterEvent: () => void;
    readonly reporterEventCount: () => number;
};

function createReporterConflictExecutionState(): ReporterConflictExecutionState {
    let bodyRan = false;
    let reporterEventCount = 0;

    return {
        bodyRan() {
            return bodyRan;
        },
        recordBodyRun() {
            bodyRan = true;
        },
        recordReporterEvent() {
            reporterEventCount += 1;
        },
        reporterEventCount() {
            return reporterEventCount;
        }
    };
}

function createCountingReporter(state: ReporterConflictExecutionState): DefinedReporter {
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'first',
        onEvent() {
            state.recordReporterEvent();
        },
        onFinish: null,
        sinks: [ { kind: 'stdout-raw' } ]
    };

    return defineReporter(function createCountingRuntimeReporter() {
        return reporter;
    });
}

function createConflictingReporter(): DefinedReporter {
    const reporter: RealTimeReporter = {
        dispose: null,
        kind: 'real-time',
        name: 'conflicting',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'stdout-raw' } ]
    };

    return defineReporter(function createConflictingRuntimeReporter() {
        return reporter;
    });
}

function createReporterConflictPlan(
    engine: Engine,
    state: ReporterConflictExecutionState
): TestPlan {
    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        state.recordBodyRun();
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'passes'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        })
    );
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
    return result.perTest.at(0)?.outcome ?? undefined;
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/execution-reporting.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() records thrown test body errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body() {
                                    throw new Error('boom');
                                },
                                annotations: {},
                                controls: {},
                                title: 'throws error'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() preserves assertions recorded before a thrown body error',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.equal(1, 2, { message: 'numbers differ' });
                                    throw new Error('boom');
                                },
                                annotations: {},
                                controls: {},
                                title: 'asserts then throws'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() records rejected test body promises as body errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                async body() {
                                    await Promise.resolve();
                                    throw new Error('rejects');
                                },
                                annotations: {},
                                controls: {},
                                title: 'rejects'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() delivers events and final results to reporters',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const realTimeReporter = createInMemoryRealTimeReporter();
                const finalResultReporter = createInMemoryFinalResultReporter();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'passes'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
                            root: {
                                annotations: resolveRootTestAnnotations({}),
                                controls: resolveRootTestControls({}),
                                title: 'root'
                            },
                            startedAt: '2026-07-15T00:00:00.000Z'
                        },
                        {
                            attempt: 0,
                            case: { file: null, title: 'passes', params: null, suite: [] },
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            kind: 'test-start',
                            suitePath: []
                        },
                        {
                            attempt: 0,
                            case: { file: null, title: 'passes', params: null, suite: [] },
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            artifacts: [],
                            kind: 'test-end',
                            outcome: { kind: 'pass' },
                            suitePath: [],
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() emits suite events for table path segments',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const realTimeReporter = createInMemoryRealTimeReporter();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'first'
                            }),
                            engine.createTable({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                cases: [
                                    {
                                        body(testScope) {
                                            testScope.assert.true(true, { message: 'row passes' });
                                            return testScope.assert.collect();
                                        },
                                        annotations: {},
                                        controls: {},
                                        title: 'row 1',
                                        parameters: {}
                                    },
                                    {
                                        body(testScope) {
                                            testScope.assert.true(true, { message: 'row passes' });
                                            return testScope.assert.collect();
                                        },
                                        annotations: {},
                                        controls: {},
                                        title: 'row 2',
                                        parameters: {}
                                    }
                                ],
                                annotations: {},
                                controls: {},
                                title: 'rows'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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

                scope.assert.deepEqual(plainDataShape(suiteEvents), [
                    {
                        kind: 'suite-start',
                        suitePath: [ {
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            title: 'rows'
                        } ]
                    },
                    {
                        kind: 'suite-end',
                        suitePath: [ {
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            title: 'rows'
                        } ]
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() rejects reporter sink conflicts before starting the run',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const executionState = createReporterConflictExecutionState();
                const testPlan = createReporterConflictPlan(engine, executionState);

                await scope.assert.rejects(async function executeWithConflictingReporters() {
                    await engine.execute(testPlan, {
                        execution: { mode: 'serial-in-process' },
                        reporters: [
                            createCountingReporter(executionState),
                            createConflictingReporter()
                        ],
                        runFacts: {},
                        startedAt: '2026-07-15T00:00:00.000Z'
                    });
                }, { message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.' });
                scope.assert.equal(executionState.bodyRan(), false);
                scope.assert.equal(executionState.reporterEventCount(), 0);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
