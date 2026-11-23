import { type TestScope, suite, test } from '@overkill-dev/test';
import { defineCompositeAssertion as definePublishedCompositeAssertion } from '@overkill-dev/test/assert';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { serializeValue } from '../compare/serialized-value.ts';

import { defineFixedReporter } from '../test-support/reporter-definition.ts';
import type { DefinedReporter } from './reporter.ts';
import type { AssertionTestFailure, FailOutcome, RunResult, RunnerError } from './run-result.ts';

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

async function executeSingleBody(
    body: EngineCaseBody,
    reporters: readonly DefinedReporter[] = []
): Promise<RunResult> {
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
        ),
        {
            debug: { mode: 'off' },
            execution: { mode: 'serial-in-process' },
            reporters,
            retryPolicy: null,
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z'
        }
    );
}

function firstAssertionFailure(outcome: FailOutcome): AssertionTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    return null;
}

const capturedTestLocation = definePublishedCompositeAssertion({
    name: 'captured test location',
    assert(check, location: SourceLocation) {
        if (location.kind === 'unknown') {
            return check.equal(location.kind, 'known');
        }

        return check.group([
            check.match(location.file.replaceAll('\\', '/'), /source\/engine\/assertion-execution\.test\.ts$/u),
            check.equal(typeof location.line, 'number'),
            check.equal(typeof location.column, 'number')
        ]);
    }
});

function firstFailedCheck(outcome: FailOutcome): FailedCheck | null {
    return firstAssertionFailure(outcome)?.checks.at(0) ?? null;
}

export const testNode = suite('Assertion execution', [
    test('rejects a microtask queued before an async body returns', async function (scope: TestScope) {
        let invoked = false;
        const result = await executeSingleBody(async function body(testScope) {
            await Promise.resolve();
            testScope.assert.true(true);
            queueMicrotask(function recordLateAssertion() {
                try {
                    testScope.assert.throws(function lateThunk() {
                        invoked = true;
                        throw new Error('late');
                    }, { message: 'late' });
                } catch {
                }
            });
            return testScope.assert.collect();
        });

        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.false(invoked);
        scope.assert.partialDeepEqual<unknown, unknown>(outcome.failures[0], {
            code: 'late-assertion-activity',
            kind: 'test-contract'
        });
        return scope.assert.collect();
    }),
    test('retains a caught cleanup assertion as a contract failure', async function (scope: TestScope) {
        const result = await executeSingleBody(function body(testScope) {
            testScope.cleanup(function cleanUp() {
                try {
                    testScope.plan(1);
                } catch {
                }
            });
            testScope.assert.true(true);
            return testScope.assert.collect();
        });

        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.partialDeepEqual<unknown, unknown>(outcome.failures[0], {
            code: 'late-assertion-activity',
            kind: 'test-contract'
        });
        return scope.assert.collect();
    }),
    test('reports a late call after test-end without changing the published verdict', async function (scope) {
        let escaped: (() => void) | null = null;
        const observed: RunnerError[] = [];
        const result = await executeSingleBody(function body(testScope) {
            escaped = function recordLateAssertion() {
                testScope.assert.true(true);
            };
            testScope.assert.true(true);
            return testScope.assert.collect();
        }, [ defineFixedReporter({
            kind: 'real-time',
            name: 'late assertion observer',
            sinks: [ { kind: 'memory' } ],
            dispose: null,
            onFinish: null,
            onEvent(event) {
                if (event.kind === 'runner-error') {
                    observed.push(event.error);
                }
                if (event.kind === 'test-end' && escaped !== null) {
                    try {
                        escaped();
                    } catch {
                    }
                }
            }
        }) ]);

        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.perTest[0]?.verdict, 'pass');
        scope.assert.length(result.runnerErrors, 1);
        scope.assert.deepEqual(observed, result.runnerErrors);
        scope.assert.partialDeepEqual<unknown, unknown>(result.runnerErrors[0], {
            subtype: 'attribution-drift',
            cause: {
                kind: 'late-assertion-activity',
                origin: {
                    case: result.perTest[0]?.id,
                    work: result.perTest[0]?.workId,
                    attempt: { index: 0 },
                    trial: null
                }
            }
        });
        return scope.assert.collect();
    }),
    test('rejects a pending assertion that finishes during cleanup', async function (scope: TestScope) {
        const gate = Promise.withResolvers<never>();
        const result = await executeSingleBody(function body(testScope) {
            testScope.assert.true(true);
            const assertions = testScope.assert.collect();
            const pending = testScope.assert.rejects(async function waitForApplication() {
                return await gate.promise;
            }, { message: 'application error' });
            const observed = (async function observeLateRejection() {
                try {
                    await pending;
                } catch {
                }
            })();
            testScope.cleanup(async function finishPendingAssertion() {
                gate.reject(new Error('application error'));
                await observed;
            });
            return assertions;
        });

        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.partialDeepEqual<unknown, unknown>(outcome.failures[0], {
            code: 'late-assertion-activity',
            actual: { operation: 'finish an asynchronous assertion' }
        });
        return scope.assert.collect();
    }),
    test('keeps collecting snapshots until the body settles', async function (scope) {
        const result = await executeSingleBody(function body(testScope) {
            testScope.assert.true(true);
            testScope.assert.collect();
            testScope.assert.false(false);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.perTest[0]?.verdict, 'pass');
        return scope.assert.collect();
    }),
    test(
        'counts successful requirements once a returned assertion result exists',
        async function (scope) {
            const result = await executeSingleBody(function testBody(testScope) {
                const testScopeRequire: typeof testScope.require = testScope.require;

                testScope.plan(2);
                testScopeRequire.string('value');
                testScope.assert.true(true);
                return testScope.assert.collect();
            });

            scope.assert.equal(result.summary.passed, 1);

            return scope.assert.collect();
        }
    ),
    test('rejects successful require-only builder collection', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            const testScopeRequire: typeof testScope.require = testScope.require;

            testScopeRequire.string('value');
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures, [
            {
                actual: 0,
                code: 'no-assertions',
                expected: 'at least one assertion',
                kind: 'test-contract',
                summary: 'Expected at least one assertion.'
            }
        ]);

        return scope.assert.collect();
    }),
    test('retains a caught failed requirement after its operand changes', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            const testScopeRequire: typeof testScope.require = testScope.require;
            const user: Record<string, unknown> = {};
            try {
                testScopeRequire.hasProperty(user, 'name', { message: 'requires the name' });
            } catch {
                user.name = 'Ada';
            }
            testScope.assert.equal(user.name, 'Ada');
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        const check = firstFailedCheck(outcome);
        scope.require.notNull(check);
        scope.assert.equal(check.source, 'require');
        scope.assert.equal(check.summary, 'requires the name');
        return scope.assert.collect();
    }),
    test('skips plan mismatch when a requirement fails', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            const testScopeRequire: typeof testScope.require = testScope.require;

            testScope.plan(2);
            testScopeRequire.string(1, { message: 'required string' });
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        const check = firstFailedCheck(outcome);
        scope.require.notNull(check);
        scope.assert(capturedTestLocation, check.sourceLocations[0]);

        scope.assert.deepEqual(outcome.failures, [
            {
                checks: [
                    {
                        actual: serializeValue(1),
                        diff: null,
                        expected: serializeValue('string'),
                        id: '1',
                        kind: 'leaf',
                        sourceLocations: [ check.sourceLocations[0] ],
                        path: [],
                        source: 'require',
                        summary: 'required string'
                    }
                ],
                kind: 'assertion'
            }
        ]);

        return scope.assert.collect();
    }),
    test(
        'treats caught failed requirements as fatal and ignores later assertions',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
                const testScopeRequire: typeof testScope.require = testScope.require;

                try {
                    testScopeRequire.string(1, { message: 'required string' });
                } catch {
                    testScope.assert.fail({ message: 'ignored failure' });
                }

                return testScope.assert.collect();
            });
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            const check = firstFailedCheck(outcome);
            scope.require.notNull(check);
            scope.assert(capturedTestLocation, check.sourceLocations[0]);

            scope.assert.deepEqual(outcome.failures, [
                {
                    checks: [
                        {
                            actual: serializeValue(1),
                            diff: null,
                            expected: serializeValue('string'),
                            id: '1',
                            kind: 'leaf',
                            sourceLocations: [ check.sourceLocations[0] ],
                            path: [],
                            source: 'require',
                            summary: 'required string'
                        }
                    ],
                    kind: 'assertion'
                }
            ]);

            return scope.assert.collect();
        }
    ),
    test(
        'rejects returned results that drop recorded builder assertions',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
                const replacement: AssertAssertionNode = {
                    actual: true,
                    check: 'true',
                    sourceLocations: [ unknownSourceLocation ],
                    message: null,
                    source: 'assert'
                };

                testScope.assert.true(true);

                return [ replacement ];
            });
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            scope.assert.deepEqual(outcome.failures, [
                {
                    actual: 'missing recorded builder assertion',
                    code: 'dead-builder-assertion',
                    expected: 'returned assertions include every recorded builder assertion',
                    kind: 'test-contract',
                    summary: 'Returned assertions must include every recorded builder assertion.'
                }
            ]);

            return scope.assert.collect();
        }
    ),
    test('rejects a node collected in another case', async function (scope: TestScope) {
        const collected: AssertAssertionNode[] = [];
        const source = await executeSingleBody(function (body) {
            body.assert.true(true);
            const nodes = body.assert.collect();
            collected.push(...nodes);
            return nodes;
        });
        const [ foreign ] = collected;
        scope.require.defined(foreign);
        const outcome = firstFailOutcome(
            await executeSingleBody(function () {
                return foreign;
            })
        );
        scope.require.notNull(outcome);

        scope.assert.equal(source.summary.passed, 1);
        scope.assert.deepEqual(
            outcome.failures.map(function (failure) {
                return failure.kind === 'test-contract' ? [ failure.code, failure.actual ] : failure.kind;
            }),
            [ [ 'invalid-returned-builder-assertion', 'foreign-owner' ] ]
        );
        return scope.assert.collect();
    }),
    test('rejects repeated recorded nodes with or without a plan', async function (scope: TestScope) {
        for (const plan of [ null, 2 ]) {
            const outcome = firstFailOutcome(
                await executeSingleBody(function (body) {
                    if (plan !== null) {
                        body.plan(plan);
                    }
                    body.assert.true(true);
                    const [ first ] = body.assert.collect();
                    return [ first, ...body.assert.collect() ];
                })
            );
            scope.require.notNull(outcome);
            scope.assert.deepEqual(
                outcome.failures.map(function (failure) {
                    return failure.kind === 'test-contract' ? [ failure.code, failure.actual ] : failure.kind;
                }),
                [ [ 'invalid-returned-builder-assertion', 'duplicate-node' ] ]
            );
        }
        return scope.assert.collect();
    }),
    test('counts distinct recorded calls and reused lazy protocol nodes', async function (scope) {
        let actual = false;
        const lazy: AssertAssertionNode = {
            get actual() {
                return actual;
            },
            check: 'true',
            message: null,
            source: 'assert',
            sourceLocations: [ unknownSourceLocation ]
        };
        const result = await executeSingleBody(function (body) {
            body.plan(4);
            body.assert.true(true);
            const [ first ] = body.assert.collect();
            body.assert.true(true);
            const [ , second ] = body.assert.collect();
            if (second === undefined) {
                throw new Error('Expected a second recorded assertion.');
            }
            actual = true;
            return [ lazy, first, second, lazy ];
        });

        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test(
        'accepts appended direct assertions around builder assertions',
        async function (scope) {
            const result = await executeSingleBody(function testBody(testScope) {
                const leading: AssertAssertionNode = {
                    actual: true,
                    check: 'true',
                    sourceLocations: [ unknownSourceLocation ],
                    message: null,
                    source: 'assert'
                };
                const trailing: AssertAssertionNode = {
                    actual: false,
                    check: 'false',
                    sourceLocations: [ unknownSourceLocation ],
                    message: null,
                    source: 'assert'
                };

                testScope.plan(3);
                testScope.assert.true(true);

                return [ leading, ...testScope.assert.collect(), trailing ];
            });

            scope.assert.equal(result.summary.passed, 1);

            return scope.assert.collect();
        }
    ),
    test(
        'merges successful requirements by timeline for counts and check ids',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
                const testScopeRequire: typeof testScope.require = testScope.require;

                testScope.plan(3);
                testScope.assert.equal(1, 2, { message: 'first assert' });
                testScopeRequire.string('value');
                testScope.assert.equal(3, 4, { message: 'second assert' });
                return testScope.assert.collect();
            });
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            scope.assert.deepEqual(
                outcome.failures.flatMap(function failedChecks(failure) {
                    return failure.kind === 'assertion'
                        ? failure.checks.map(function toCheck(check) {
                            return { id: check.id, summary: check.summary };
                        })
                        : [];
                }),
                [
                    { id: '1', summary: 'first assert' },
                    { id: '3', summary: 'second assert' }
                ]
            );

            return scope.assert.collect();
        }
    )
]);
