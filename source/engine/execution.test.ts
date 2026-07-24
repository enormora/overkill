import assert from 'node:assert/strict';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { registerTest } from '../test-support/register-test.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { RealTimeReporter, ReporterEvent } from './reporter.ts';
import type { FailOutcome, RunResult } from './run-result.ts';
import type { TestBody } from './test-node.ts';

function recordedEvents(reporter: InMemoryRealTimeReporter): readonly ReporterEvent[] {
    return reporter.getRecordedEntries().flatMap(function toEvent(entry) {
        return entry.event === null ? [] : [ entry.event ];
    });
}

function firstFailOutcome(result: RunResult): FailOutcome {
    const firstResult = result.perTest.at(0);

    assert.notEqual(firstResult, undefined);

    if (firstResult === undefined) {
        throw new TypeError('Expected at least one test result.');
    }

    if (firstResult.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    throw new TypeError('Expected first outcome to fail.');
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createSuite({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        name: 'case'
                    })
                ],
                metadata: {},
                name: 'root'
            })
        )
    );
}

registerTest('execute() returns passing and failing outcomes with run counts', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.ok(true, 'passes');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'passes'
                }),
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.equal(1, 2, 'numbers differ');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'fails'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.planned, 2);
    assert.equal(result.summary.defined, 3);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.bySuite.root, { discovered: 2, executed: 2, planned: 2 });
    assert.deepStrictEqual(
        result.perTest.map(function toVerdict(testResult) {
            return testResult.verdict;
        }),
        [ 'pass', 'fail' ]
    );
});

registerTest('execute() carries orphaned nodes from the plan', async function () {
    const engine = createEngine();
    const reached = engine.createTestCase({
        body(testContext) {
            testContext.assert.ok(true, 'passes');
            return testContext.assert.done();
        },
        metadata: {},
        name: 'reached'
    });
    engine.createTable({
        cases: [],
        metadata: {},
        name: 'unused rows'
    });
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [ reached ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.deepStrictEqual(result.orphans, [ { file: null, kind: 'table', name: 'unused rows' } ]);
    assert.equal(result.summary.defined, 3);
    assert.equal(result.summary.discovered, 1);
    assert.equal(result.summary.planned, 1);
});

registerTest('execute() fails tests with zero assertions', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'empty'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.perTest[0]?.outcome, {
        failures: [
            {
                actual: 0,
                code: 'no-assertions',
                expected: 'at least one assertion',
                kind: 'test-contract',
                summary: 'Expected at least one assertion.'
            }
        ],
        kind: 'fail'
    });
});

registerTest('execute() fails tests when assertion plan count does not match', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.plan(2);
                        testContext.assert.ok(true, 'one');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'planned'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.perTest[0]?.outcome, {
        failures: [
            {
                actual: 1,
                code: 'plan-mismatch',
                expected: '2',
                kind: 'test-contract',
                summary: 'Assertion plan count did not match.'
            }
        ],
        kind: 'fail'
    });
});

registerTest('execute() accepts a directly returned assertion node', async function () {
    const result = await executeSingleBody(function body() {
        return {
            actual: true,
            check: 'ok',
            summary: 'direct assertion'
        };
    });

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() fails tests with invalid assertion plans', async function () {
    const result = await executeSingleBody(function body(testContext) {
        testContext.plan(0);
        testContext.assert.ok(true, 'unreached');
        return testContext.assert.done();
    });

    assert.deepStrictEqual(firstFailOutcome(result).failures[0], {
        actual: 0,
        code: 'invalid-plan',
        expected: 'positive integer plan before assertions',
        kind: 'test-contract',
        summary: 'Assertion plan must be a positive integer before assertions.'
    });
});

registerTest('execute() exposes assertion and requirement convenience methods', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.ok(true, 'one');
                        testContext.require.equal(1, 1, 'equal');
                        testContext.require.ok(true, 'ok');
                        testContext.assert.ok(true, 'passes');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'uses context'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() fails the test when a requirement fails', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.require.equal(1, 2, 'required equality');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'requires equality'
                }),
                engine.createTestCase({
                    body(testContext) {
                        testContext.require.ok(false, 'required truth');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'requires truth'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await engine.execute(testPlan);

    assert.equal(result.summary.failed, 2);
    assert.deepStrictEqual(
        result.perTest.map(function toSummary(testResult) {
            if (testResult.outcome.kind !== 'fail') {
                return null;
            }

            const failure = testResult.outcome.failures[0];
            return failure.kind === 'assertion' ? failure.checks[0].summary : null;
        }),
        [ 'required equality', 'required truth' ]
    );
});

registerTest('execute() records thrown test body errors', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
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

    assert.equal(result.summary.failed, 1);
    const outcome = firstFailOutcome(result);
    assert.deepStrictEqual(
        outcome.failures.map(function toFailureKind(failure) {
            return failure.kind;
        }),
        [ 'body-error' ]
    );
    const failure = outcome.failures[0];
    assert.equal(failure.kind, 'body-error');
    assert.equal(failure.error.name, 'Error');
    assert.equal(failure.error.message, 'boom');
});

registerTest('execute() preserves assertions recorded before a thrown body error', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.equal(1, 2, 'numbers differ');
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
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(
        outcome.failures.map(function toFailureKind(failure) {
            return failure.kind;
        }),
        [ 'assertion', 'body-error' ]
    );
});

registerTest('execute() records rejected test body promises as body errors', async function () {
    const engine = createEngine();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
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
    const outcome = firstFailOutcome(result);

    assert.equal(outcome.failures[0].kind, 'body-error');
});

registerTest('execute() delivers events and final results to reporters', async function () {
    const engine = createEngine();
    const realTimeReporter = createInMemoryRealTimeReporter();
    const finalResultReporter = createInMemoryFinalResultReporter();
    const testPlan = engine.createTestPlan(
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

    const result = await engine.execute(testPlan, {
        reporters: [ realTimeReporter, finalResultReporter ],
        runFacts: { seed: 42 },
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(
        recordedEvents(realTimeReporter),
        [
            { facts: { seed: 42 }, kind: 'run-start', startedAt: '2026-07-15T00:00:00.000Z' },
            { kind: 'suite-start', suitePath: [ 'root' ] },
            { attempt: 0, case: { file: null, name: 'passes', params: null, suite: [ 'root' ] }, kind: 'test-start' },
            {
                attempt: 0,
                case: { file: null, name: 'passes', params: null, suite: [ 'root' ] },
                kind: 'test-end',
                outcome: { kind: 'pass' },
                verdict: 'pass',
                wallTimeMs: 0
            },
            { kind: 'suite-end', suitePath: [ 'root' ] },
            { kind: 'run-end', result }
        ]
    );
    assert.deepStrictEqual(
        finalResultReporter.getRecordedEntries(),
        [ { event: null, result, type: 'result' } ]
    );
});

registerTest('execute() emits suite events for table path segments', async function () {
    const engine = createEngine();
    const realTimeReporter = createInMemoryRealTimeReporter();
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.ok(true, 'passes');
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'first'
                }),
                engine.createTable({
                    cases: [
                        {
                            body(testContext) {
                                testContext.assert.ok(true, 'row passes');
                                return testContext.assert.done();
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

    assert.deepStrictEqual(suiteEvents, [
        { kind: 'suite-start', suitePath: [ 'root' ] },
        { kind: 'suite-start', suitePath: [ 'root', 'rows' ] },
        { kind: 'suite-end', suitePath: [ 'root', 'rows' ] },
        { kind: 'suite-end', suitePath: [ 'root' ] }
    ]);
});

registerTest('execute() rejects reporter sink conflicts before starting the run', async function () {
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
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        bodyRan = true;
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

    await assert.rejects(
        async function executeWithConflictingReporters() {
            await engine.execute(testPlan, {
                reporters: [
                    { ...realTimeReporter, sinks: [ { conflictPolicy: 'exclusive', kind: 'stdout' } ] },
                    conflictingReporter
                ],
                runFacts: {},
                startedAt: '2026-07-15T00:00:00.000Z'
            });
        },
        { message: 'Reporter sink conflict: stdout is claimed exclusively.' }
    );
    assert.equal(bodyRan, false);
    assert.deepStrictEqual(realTimeReporter.getRecordedEntries(), []);
});
