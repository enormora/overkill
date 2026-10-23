import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { AssertionTestFailure, FailOutcome, RunResult, TestFailure, TestOutcome } from '../engine/run-result.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { testNode as publishedRunnerTestNode } from './published-runner.test.ts';
import { runResultFactory } from './run-result-factory.ts';

function defaultFailure(): unknown {
    return {
        actual: serializeValue(null),
        diff: null,
        expected: serializeValue(null),
        id: 'check',
        kind: 'leaf',
        path: [],
        source: 'assert',
        sourceLocations: [
            {
                column: null,
                file: 'source/example.test.ts',
                kind: 'known',
                line: null
            }
        ],
        summary: 'Check failed'
    };
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

const assertionTestFailure = defineNarrowingCompositeAssertion<TestFailure, AssertionTestFailure, readonly []>({
    name: 'assertion test failure',
    narrows(actual): actual is AssertionTestFailure {
        return actual.kind === 'assertion';
    }
});

function assertExplicitFailureFields(scope: OverkillScope, runResult: RunResult): void {
    const failedOutcome = runResult.perTest[0]?.outcome;
    scope.require.defined(failedOutcome);
    scope.require(failOutcome, failedOutcome);
    const failure = failedOutcome.failures[0];
    scope.require(assertionTestFailure, failure);
    scope.assert.deepEqual(failure.checks[0], {
        ...(defaultFailure() as Record<string, unknown>),
        actual: serializeValue(1),
        expected: serializeValue(2),
        sourceLocations: [
            {
                column: null,
                file: 'source/example.test.ts',
                kind: 'known',
                line: 10
            }
        ]
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/test-support/run-result-factory.test.ts',
    annotations: {},
    controls: {},
    children: [
        publishedRunnerTestNode,
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runResultFactory builds nested result data',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    orphans: [ {} ],
                    perTest: [
                        {
                            outcome: {
                                checks: [ { summary: 'custom failure' } ],
                                kind: 'fail'
                            },
                            verdict: 'fail'
                        }
                    ],
                    runnerErrors: [ { message: 'custom runner error' } ]
                });

                scope.assert.equal(runResult.orphans[0]?.title, 'orphaned test');
                const outcome = runResult.perTest[0]?.outcome;
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                const failure = outcome.failures[0];
                scope.require(assertionTestFailure, failure);
                scope.assert.deepEqual(
                    {
                        failureKind: failure.kind,
                        failureSummary: failure.checks[0].summary,
                        orphanTitle: runResult.orphans[0]?.title,
                        runnerErrorMessage: runResult.runnerErrors[0]?.message
                    },
                    {
                        failureKind: 'assertion',
                        failureSummary: 'custom failure',
                        orphanTitle: 'orphaned test',
                        runnerErrorMessage: 'custom runner error'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runResultFactory builds non-failing outcome variants',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    perTest: [
                        { outcome: { kind: 'pass' } },
                        { outcome: { kind: 'skip' } },
                        { outcome: { kind: 'inconclusive' } }
                    ]
                });

                scope.assert.deepEqual(
                    runResult.perTest.map(function toOutcome(testResult) {
                        return testResult.outcome;
                    }),
                    [
                        { kind: 'pass' },
                        { kind: 'skip', reason: 'Skipped' },
                        { kind: 'inconclusive', reason: 'Inconclusive' }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runResultFactory builds default and empty failure fallbacks',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    perTest: [
                        { outcome: { kind: 'fail' } },
                        { outcome: { failures: [], kind: 'fail' } },
                        { outcome: { checks: [], kind: 'fail' } }
                    ]
                });

                const outcomes = runResult.perTest.map(function toOutcome(testResult) {
                    return testResult.outcome;
                });
                const outcomeShape = plainDataShape(outcomes);

                scope.assert.deepEqual(
                    outcomeShape,
                    [
                        {
                            failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                            kind: 'fail'
                        },
                        {
                            failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                            kind: 'fail'
                        },
                        {
                            failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                            kind: 'fail'
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runResultFactory builds body-error and default contract failures',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    perTest: [
                        { outcome: { failures: [ { kind: 'body-error' } ], kind: 'fail' } },
                        { outcome: { failures: [ { kind: 'test-contract' } ], kind: 'fail' } }
                    ]
                });

                scope.assert.equal(runResult.perTest[0]?.outcome?.kind, 'fail');
                scope.assert.equal(runResult.perTest[1]?.outcome?.kind, 'fail');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runResultFactory preserves explicit failure and verdict fields',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    perTest: [
                        {
                            outcome: {
                                checks: [ { actual: 1, expected: 2, sourceLocations: [ { line: 10 } ] } ],
                                kind: 'fail'
                            }
                        },
                        { outcome: { kind: 'skip', reason: 'Not now' }, verdict: 'inconclusive' },
                        { outcome: null }
                    ]
                });

                assertExplicitFailureFields(scope, runResult);
                scope.assert.equal(runResult.perTest[1]?.verdict, 'inconclusive');
                scope.assert.equal(runResult.perTest[1]?.outcome?.kind, 'skip');
                scope.assert.equal(runResult.perTest[2]?.verdict, 'crashed');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('#test-runner');

await runIfMain(import.meta, testNode);
