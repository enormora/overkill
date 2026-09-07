import { defineNarrowingCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import {
    defineReporter,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type Reporter,
    type ReporterEvent,
    type TestBody,
    type TestNode,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { AssertionTestFailure, FailOutcome, RunResult, TestFailure, TestOutcome } from '../engine/run-result.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { runIfMain } from './run-if-main.ts';
import { runResultFactory } from './run-result-factory.ts';

type CapturedRoot = {
    readonly tags: readonly string[];
    readonly title: string;
};

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
                line: 10
            }
        ]
    });
}

function importMeta(main: boolean): Readonly<ImportMeta> {
    return {
        dirname: '/workspace',
        filename: '/workspace/direct.test.ts',
        main,
        resolve(specifier: string) {
            return import.meta.resolve(specifier);
        },
        url: 'file:///workspace/direct.test.ts'
    };
}

function passingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

function failingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(false);

    return scope.assert.collect();
}

function supportTestCase(body: TestBody): TestNode {
    return createOverkillTestCase({
        body,
        definitionLocations: [ { column: null, file: '', line: null } ],
        metadata: {},
        title: 'case'
    });
}

function captureRoot(recordRoot: (root: CapturedRoot) => void): Reporter {
    return defineReporter({
        dispose: null,
        kind: 'real-time',
        name: 'capture-root',
        onEvent(event: ReporterEvent) {
            if (event.kind === 'run-start') {
                recordRoot({
                    tags: event.root.metadata.tags,
                    title: event.root.title
                });
            }
        },
        onFinish: null,
        sinks: []
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/test-support/run-result-factory.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'runResultFactory builds nested result data',
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
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'runResultFactory builds non-failing outcome variants',
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
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'runResultFactory builds default and empty failure fallbacks',
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
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'runResultFactory builds body-error and default contract failures',
            metadata: {},
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
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'runResultFactory preserves explicit failure and verdict fields',
            metadata: {},
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'test support runIfMain() returns without running imported modules',
            metadata: {},
            async body(scope: OverkillScope) {
                const originalExitCode = process.exitCode;

                try {
                    process.exitCode = undefined;

                    await runIfMain(importMeta(false), supportTestCase(failingBody), { reporters: [] });

                    scope.assert.equal(process.exitCode, undefined);
                } finally {
                    process.exitCode = originalExitCode;
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'test support runIfMain() runs direct files with explicit root options',
            metadata: {},
            async body(scope: OverkillScope) {
                const roots: CapturedRoot[] = [];

                await runIfMain(importMeta(true), supportTestCase(passingBody), {
                    outputRenderer: {
                        render(intent) {
                            return intent.text;
                        }
                    },
                    reporters: [
                        captureRoot(function recordRoot(root) {
                            roots.push(root);
                        })
                    ],
                    root: {
                        metadata: { tags: [ 'support' ] },
                        title: 'support-root'
                    }
                });

                scope.assert.deepEqual(roots, [
                    {
                        tags: [ 'support' ],
                        title: 'support-root'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'test support runIfMain() sets a failure exit code for failing direct files',
            metadata: {},
            async body(scope: OverkillScope) {
                const originalExitCode = process.exitCode;

                try {
                    process.exitCode = undefined;

                    await runIfMain(importMeta(true), supportTestCase(failingBody), { reporters: [] });

                    scope.assert.equal(process.exitCode, 1);
                } finally {
                    process.exitCode = originalExitCode;
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('./run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
