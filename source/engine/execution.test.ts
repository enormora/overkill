import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import type { KnownSourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { Engine } from './engine.ts';
import type { FailOutcome, RunResult, TestOutcome } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

type SourceLocation = KnownSourceLocation;

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
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body,
                        annotations: {},
                        controls: {},
                        title: 'case'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
            })
        )
    );
}

function createPassingCase(engine: Engine, title: string): ReturnType<Engine['createTestCase']> {
    return engine.createTestCase({
        definitionLocations: [ { kind: 'unknown' as const } ],
        body(testScope) {
            testScope.assert.true(true, { message: 'passes' });
            return testScope.assert.collect();
        },
        annotations: {},
        controls: {},
        title
    });
}

function createPlanWithUnusedTable(
    engine: Engine,
    unusedTableLocation: SourceLocation
): ReturnType<Engine['createTestPlan']> {
    const reached = createPassingCase(engine, 'reached');

    engine.createTable({
        cases: [],
        definitionLocations: [ unusedTableLocation ],
        annotations: {},
        controls: {},
        title: 'unused rows'
    });

    return engine.createTestPlan(engine.createRoot({
        children: [ reached ],
        annotations: {},
        controls: {},
        title: 'root'
    }));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/execution.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() returns passing and failing outcomes with run counts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'passes'
                            }),
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    testScope.assert.equal(1, 2, { message: 'numbers differ' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'fails'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() carries orphaned nodes from the plan',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const unusedTableLocation = {
                    column: 3,
                    file: 'source/orphaned-table.test.ts',
                    kind: 'known' as const,
                    line: 5
                };
                const testPlan = createPlanWithUnusedTable(engine, unusedTableLocation);
                const result = await engine.execute(testPlan);

                scope.assert.deepEqual(result.orphans, [
                    { definitionLocations: [ unusedTableLocation ], file: null, kind: 'table', title: 'unused rows' }
                ]);
                scope.assert.equal(result.summary.defined, 2);
                scope.assert.equal(result.summary.discovered, 1);
                scope.assert.equal(result.summary.planned, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() fails tests with zero assertions',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'empty'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() fails tests when assertion plan count does not match',
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
                                    testScope.plan(2);
                                    testScope.assert.true(true, { message: 'one' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'planned'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() accepts a directly returned assertion node',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function body() {
                    return {
                        actual: true,
                        check: 'true',
                        message: 'direct assertion',
                        source: 'assert',
                        sourceLocations: [ unknownSourceLocation ]
                    };
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() fails tests with invalid assertion plans',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() exposes assertion and requirement convenience methods',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    testScope.assert.true(true, { message: 'one' });
                                    testScope.require.string('value', { message: 'string' });
                                    testScope.require.defined(true, { message: 'defined' });
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'uses context'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );

                const result = await engine.execute(testPlan);

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() fails the test when a requirement fails',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    testScope.require.string(1, { message: 'required string' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'requires equality'
                            }),
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope: TestScope) {
                                    testScope.require.defined(null, { message: 'required defined' });
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'requires truth'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
