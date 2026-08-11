import { defineNarrowingCompositeAssertion } from '@overkill-dev/assert';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { AssertionTestFailure, FailOutcome, TestFailure, TestOutcome } from '../engine/run-result.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { runResultFactory } from './run-result-factory.ts';

function defaultFailure(): unknown {
    return {
        actual: serializeValue(null),
        diff: null,
        expected: serializeValue(null),
        id: 'check',
        kind: 'leaf',
        location: {
            column: null,
            file: 'source/example.test.ts',
            line: null
        },
        path: [],
        source: 'assert',
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

export const testSuite = createOverkillSuite({
    name: 'source/test-support/run-result-factory.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'runResultFactory builds nested result data',
            metadata: {},
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

                scope.assert.equal(runResult.orphans[0]?.name, 'orphaned test');
                const outcome = runResult.perTest[0]?.outcome;
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                const failure = outcome.failures[0];
                scope.require(assertionTestFailure, failure);
                scope.assert.deepEqual(
                    {
                        failureKind: failure.kind,
                        failureSummary: failure.checks[0].summary,
                        orphanName: runResult.orphans[0]?.name,
                        runnerErrorMessage: runResult.runnerErrors[0]?.message
                    },
                    {
                        failureKind: 'assertion',
                        failureSummary: 'custom failure',
                        orphanName: 'orphaned test',
                        runnerErrorMessage: 'custom runner error'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runResultFactory builds non-failing outcome variants',
            metadata: {},
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
            name: 'runResultFactory builds default and empty failure fallbacks',
            metadata: {},
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
            name: 'runResultFactory builds body-error and default contract failures',
            metadata: {},
            body(scope: OverkillScope) {
                const runResult = runResultFactory.build({
                    perTest: [
                        { outcome: { failures: [ { kind: 'body-error' } ], kind: 'fail' } },
                        { outcome: { failures: [ { kind: 'test-contract' } ], kind: 'fail' } }
                    ]
                });

                scope.assert.equal(runResult.perTest[0]?.outcome.kind, 'fail');
                scope.assert.equal(runResult.perTest[1]?.outcome.kind, 'fail');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
