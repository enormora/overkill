import { defineNarrowingCompositeAssertion } from '@overkill-dev/assert';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import type { FailOutcome, RunResult, TestOutcome } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

const failOutcome = defineNarrowingCompositeAssertion<TestOutcome, FailOutcome, readonly []>({
    name: 'fail outcome',
    narrows(actual): actual is FailOutcome {
        return actual.kind === 'fail';
    }
});

function firstOutcome(result: RunResult): TestOutcome | undefined {
    return result.perTest.at(0)?.outcome ?? undefined;
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
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

export const testSuite = createOverkillSuite({
    name: 'source/engine/execution.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() returns passing and failing outcomes with run counts',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                metadata: {},
                                name: 'passes'
                            }),
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    testScope.assert.equal(1, 2, { message: 'numbers differ' });
                                    return testScope.assert.collect();
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

                scope.assert.deepEqual(
                    {
                        rootCounts: result.bySuite.root ?? null,
                        summary: result.summary,
                        verdicts: result.perTest.map(function toVerdict(testResult) {
                            return testResult.verdict;
                        })
                    },
                    {
                        rootCounts: null,
                        summary: {
                            crashed: 0,
                            defined: 2,
                            discovered: 2,
                            failed: 1,
                            inconclusive: 0,
                            passed: 1,
                            planned: 2,
                            resourceExhausted: 0,
                            runtimePolicy: 0,
                            skipped: 0
                        },
                        verdicts: [ 'pass', 'fail' ]
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() carries orphaned nodes from the plan',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const reached = engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
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
                    engine.createRoot({
                        children: [ reached ],
                        metadata: {},
                        name: 'root'
                    })
                );

                const result = await engine.execute(testPlan);

                scope.assert.deepEqual(result.orphans, [ { file: null, kind: 'table', name: 'unused rows' } ]);
                scope.assert.equal(result.summary.defined, 2);
                scope.assert.equal(result.summary.discovered, 1);
                scope.assert.equal(result.summary.planned, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() fails tests with zero assertions',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    return testScope.assert.collect();
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

                scope.assert.equal(result.summary.failed, 1);
                const outcome = result.perTest[0]?.outcome;
                scope.require.defined(outcome);
                scope.assert.deepEqual(outcome, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() fails tests when assertion plan count does not match',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.plan(2);
                                    testScope.assert.true(true, { message: 'one' });
                                    return testScope.assert.collect();
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

                scope.assert.equal(result.summary.failed, 1);
                const outcome = result.perTest[0]?.outcome;
                scope.require.defined(outcome);
                scope.assert.deepEqual(outcome, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() accepts a directly returned assertion node',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function body() {
                    return {
                        actual: true,
                        check: 'true',
                        location: unknownSourceLocation,
                        message: 'direct assertion',
                        source: 'assert'
                    };
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() fails tests with invalid assertion plans',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope) {
                    testScope.plan(0);
                    testScope.assert.true(true, { message: 'unreached' });
                    return testScope.assert.collect();
                });

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                scope.assert.deepEqual(outcome.failures[0], {
                    actual: 0,
                    code: 'invalid-plan',
                    expected: 'positive integer plan before assertions',
                    kind: 'test-contract',
                    summary: 'Assertion plan must be a positive integer before assertions.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() exposes assertion and requirement convenience methods',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    testScope.assert.true(true, { message: 'one' });
                                    testScope.require.string('value', { message: 'string' });
                                    testScope.require.defined(true, { message: 'defined' });
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
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

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() fails the test when a requirement fails',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    testScope.require.string(1, { message: 'required string' });
                                    return testScope.assert.collect();
                                },
                                metadata: {},
                                name: 'requires equality'
                            }),
                            engine.createTestCase({
                                body(testScope: TestScope) {
                                    testScope.require.defined(null, { message: 'required defined' });
                                    return testScope.assert.collect();
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

                scope.assert.equal(result.summary.failed, 2);
                scope.assert.deepEqual(
                    result.perTest.map(function toSummary(testResult) {
                        if (testResult.outcome?.kind !== 'fail') {
                            return null;
                        }

                        const failure = testResult.outcome.failures[0];
                        return failure.kind === 'assertion' ? failure.checks[0].summary : null;
                    }),
                    [ 'required string', 'required defined' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
