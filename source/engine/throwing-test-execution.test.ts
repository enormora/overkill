import { AssertionError } from 'node:assert';
import assert from 'node:assert/strict';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { createPermissionDenialRuntimePolicy } from '../run/capability-policy.ts';

import { createTestEngine as createEngine, type EngineThrowingCaseBody } from '../test-support/create-test-engine.ts';
import type { TestRuntimePolicy } from './case-execution-context.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from './run-result.ts';

import { isNodeAssertionError, nodeAssertionErrorFailure } from './node-assertion-error.ts';

async function executeSingleThrowingBody(
    body: EngineThrowingCaseBody,
    runtimePolicy: TestRuntimePolicy | null
): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createThrowingTestCase({
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
            runtimePolicy,
            execution: { mode: 'serial-in-process' },
            retryPolicy: null,
            reporters: [],
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z'
        }
    );
}

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

function firstAssertionFailure(outcome: FailOutcome): AssertionTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    return null;
}

const sourceLocationInThisFileChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    location: unknown
): CompositeAssertionReturn<'assert'> {
    if (typeof location !== 'object' || location === null || !Object.hasOwn(location, 'kind')) {
        const initialChecks = check.annotated('Expected source location.').fail();
        return initialChecks;
    }
    if (Reflect.get(location, 'kind') !== 'known') {
        const initialChecks = check.equal(Reflect.get(location, 'kind'), 'known');
        return initialChecks;
    }
    const file: unknown = Reflect.get(location, 'file');
    if (typeof file !== 'string') {
        return check.string(file);
    }
    return check.group([
        check.string(file),
        check.match(
            file.replaceAll('\\', '/'),
            /source\/engine\/throwing-test-execution\.test\.[cm]?[jt]s$/u
        )
    ]);
};

const assertNodeAssertionFailure = defineCompositeAssertion({
    name: 'node assertion failure',
    assert(checkResult, failure: AssertionTestFailure) {
        const check = failure.checks[0];
        const child = check.kind === 'composite' ? check.children[0] : null;
        if (child === null) {
            const initialChecks = checkResult.equal(check.kind, 'composite');
            return initialChecks;
        }
        if (child.kind !== 'foreign') {
            const initialChecks = checkResult.equal(child.kind, 'foreign');
            return initialChecks;
        }
        return checkResult.group([
            checkResult.deepEqual([ child.label, child.source ], [ 'node:assert', 'assert' ]),
            sourceLocationInThisFileChecks(
                checkResult.annotated('source location in this file'),
                child.sourceLocations[0]
            )
        ]);
    }
});

const assertUnknownNodeAssertionLocation = defineCompositeAssertion({
    name: 'unknown node assertion location',
    assert(checkResult, failure: AssertionTestFailure) {
        const check = failure.checks[0];
        if (check.kind !== 'composite') {
            const initialChecks = checkResult.equal(check.kind, 'composite');
            return initialChecks;
        }
        const child = check.children[0];
        if (child.kind !== 'foreign') {
            const initialChecks = checkResult.equal(child.kind, 'foreign');
            return initialChecks;
        }
        return checkResult.deepEqual(child.sourceLocations, [ { kind: 'unknown' } ]);
    }
});

export const testNode = suite('Throwing test execution', [
    test('retains preparation failures alongside a thrown Node assertion', async function (scope: TestScope) {
        const policy = createPermissionDenialRuntimePolicy();
        scope.cleanup(function stopPreparationPolicy() {
            policy.takeRunErrors();
        });
        const result = await executeSingleThrowingBody(function failedNodeAssertion() {
            assert.equal(1, 2);
        }, {
            ...policy,
            async prepareAttempt() {
                throw new Error('preparation sentinel');
            }
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(
            outcome.failures.map(function failureKind(failure) {
                return failure.kind;
            }),
            [ 'assertion', 'cleanup-error' ]
        );
        scope.assert.match(JSON.stringify(outcome), /preparation sentinel/);
        return scope.assert.collect();
    }),
    test('lets throwing test cases pass with no recorded assertions', async function (scope) {
        const result = await executeSingleThrowingBody(function noAssertions() {
            return undefined;
        }, null);

        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);

        return scope.assert.collect();
    }),
    test('evaluates assertions recorded by throwing test cases', async function (scope: TestScope) {
        const result = await executeSingleThrowingBody(function failedAssertion(testScope) {
            testScope.assert.equal(1, 2, { message: 'wrong count' });
        }, null);
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        const failure = firstAssertionFailure(outcome);
        scope.require.notNull(failure);
        scope.assert.equal(failure.checks[0].summary, 'wrong count');

        return scope.assert.collect();
    }),
    test('rejects pending async assertions from throwing test cases', async function (scope: TestScope) {
        const result = await executeSingleThrowingBody(function pendingAssertion(testScope) {
            const pendingAssertions = [ testScope.assert.rejects(async function neverResolves() {
                await Promise.race<never>([]);
            }, { message: 'no rejection' }) ];

            testScope.assert.equal(pendingAssertions.length, 1);
        }, null);
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures, [
            {
                actual: 'pending async assertion',
                code: 'pending-async-assertion',
                expected: 'all async assertions awaited before collect',
                kind: 'test-contract',
                summary: 'Async assertion must be awaited before scope.assert.collect().'
            }
        ]);

        return scope.assert.collect();
    }),
    test('keeps require failures fatal in throwing test cases', async function (scope: TestScope) {
        const result = await executeSingleThrowingBody(
            function failedRequirement(testScope) {
                const testScopeRequire: typeof testScope.require = testScope.require;

                testScopeRequire.string(1, { message: 'required string' });
            },
            null
        );
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        const failure = firstAssertionFailure(outcome);
        scope.require.notNull(failure);
        scope.assert.equal(failure.checks[0].source, 'require');
        scope.assert.equal(failure.checks[0].summary, 'required string');

        return scope.assert.collect();
    }),
    test(
        'reports Node AssertionError values as assertion failures in throwing test cases',
        async function (scope: TestScope) {
            const result = await executeSingleThrowingBody(function nodeAssertFailure() {
                assert.equal(1, 2, 'wrong count');
            }, null);
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            const failure = firstAssertionFailure(outcome);
            scope.require.notNull(failure);
            scope.assert(assertNodeAssertionFailure, failure);

            return scope.assert.collect();
        }
    ),
    test('isNodeAssertionError() detects native and structural assertion errors only', function (scope) {
        scope.assert.equal(
            isNodeAssertionError(
                new AssertionError({
                    actual: 1,
                    expected: 2,
                    operator: 'strictEqual'
                })
            ),
            true
        );
        scope.assert.equal(
            isNodeAssertionError({
                code: 'ERR_ASSERTION',
                name: 'AssertionError'
            }),
            true
        );
        scope.assert.equal(isNodeAssertionError('boom'), false);

        return scope.assert.collect();
    }),
    test(
        'reports AssertionError values without stacks as assertion failures',
        async function (scope: TestScope) {
            const result = await executeSingleThrowingBody(function assertionErrorWithoutStack() {
                const error = new AssertionError({
                    actual: 1,
                    expected: 2,
                    message: 'plain assertion',
                    operator: 'strictEqual'
                });

                Reflect.deleteProperty(error, 'stack');
                throw error;
            }, null);
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            const failure = firstAssertionFailure(outcome);
            scope.require.notNull(failure);
            scope.assert(assertUnknownNodeAssertionLocation, failure);

            return scope.assert.collect();
        }
    ),
    test(
        'nodeAssertionErrorFailure() uses fallback locations when stacks do not parse',
        function (scope: TestScope) {
            const error = new AssertionError({
                actual: 1,
                expected: 2,
                message: 'plain assertion',
                operator: 'strictEqual'
            });

            error.stack = 'AssertionError: plain assertion';
            const failure = nodeAssertionErrorFailure(error, {
                column: 4,
                file: 'fallback.test.ts',
                kind: 'known',
                line: 3
            });
            const child = failure.children[0];

            scope.require.defined(child);
            scope.assert.deepEqual(child.sourceLocations, [
                {
                    column: 4,
                    file: 'fallback.test.ts',
                    kind: 'known',
                    line: 3
                }
            ]);

            return scope.assert.collect();
        }
    ),
    test(
        'keeps ordinary thrown errors as body errors in throwing test cases',
        async function (scope: TestScope) {
            const result = await executeSingleThrowingBody(function bodyError() {
                throw new Error('boom');
            }, null);
            const outcome = firstFailOutcome(result);

            scope.require.notNull(outcome);
            const failure = outcome.failures[0];
            if (failure.kind !== 'body-error') {
                scope.assert.equal(failure.kind, 'body-error');

                return scope.assert.collect();
            }

            scope.assert.equal(failure.error.message, 'boom');

            return scope.assert.collect();
        }
    )
]);
