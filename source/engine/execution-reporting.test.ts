import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
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
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { resolveRootMetadata } from './metadata.ts';
import type { RealTimeReporter, ReporterEvent } from './reporter.ts';
import type {
    BodyErrorTestFailure,
    FailOutcome,
    RunResult,
    TestFailure,
    TestOutcome
} from './run-result.ts';

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
    return result.perTest.at(0)?.outcome ?? undefined;
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/execution-reporting.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'execute() records thrown test body errors',
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
                                title: 'throws error'
                            })
                        ],
                        metadata: {},
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
            title: 'execute() preserves assertions recorded before a thrown body error',
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
                                title: 'asserts then throws'
                            })
                        ],
                        metadata: {},
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
            title: 'execute() records rejected test body promises as body errors',
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
                                title: 'rejects'
                            })
                        ],
                        metadata: {},
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
            title: 'execute() delivers events and final results to reporters',
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
                                title: 'passes'
                            })
                        ],
                        metadata: {},
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
                            root: { metadata: resolveRootMetadata({}), title: 'root' },
                            startedAt: '2026-07-15T00:00:00.000Z'
                        },
                        {
                            attempt: 0,
                            case: { file: null, title: 'passes', params: null, suite: [] },
                            kind: 'test-start'
                        },
                        {
                            attempt: 0,
                            case: { file: null, title: 'passes', params: null, suite: [] },
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
            title: 'execute() emits suite events for table path segments',
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
                                title: 'first'
                            }),
                            engine.createTable({
                                cases: [
                                    {
                                        body(testScope) {
                                            testScope.assert.true(true, { message: 'row passes' });
                                            return testScope.assert.collect();
                                        },
                                        metadata: {},
                                        title: 'row 1',
                                        parameters: {}
                                    },
                                    {
                                        body(testScope) {
                                            testScope.assert.true(true, { message: 'row passes' });
                                            return testScope.assert.collect();
                                        },
                                        metadata: {},
                                        title: 'row 2',
                                        parameters: {}
                                    }
                                ],
                                metadata: {},
                                title: 'rows'
                            })
                        ],
                        metadata: {},
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

                scope.assert.deepEqual(suiteEvents, [
                    { kind: 'suite-start', suitePath: [ 'rows' ] },
                    { kind: 'suite-end', suitePath: [ 'rows' ] }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() rejects reporter sink conflicts before starting the run',
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
                    sinks: [ { kind: 'stdout-raw' } ]
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
                                title: 'passes'
                            })
                        ],
                        metadata: {},
                        title: 'root'
                    })
                );

                await scope.assert.rejects(async function executeWithConflictingReporters() {
                    await engine.execute(testPlan, {
                        execution: { mode: 'serial-in-process' },
                        reporters: [
                            { ...realTimeReporter, sinks: [ { kind: 'stdout-raw' } ] },
                            conflictingReporter
                        ],
                        runFacts: {},
                        startedAt: '2026-07-15T00:00:00.000Z'
                    });
                }, { message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.' });
                scope.assert.equal(bodyRan, false);
                scope.assert.deepEqual(realTimeReporter.getRecordedEntries(), []);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
