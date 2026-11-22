import assert from 'node:assert/strict';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import {
    type TestCase,
    type TestPlan,
    createRoot,
    createTestPlan,
    execute,
    ownsTestNode
} from '../engine/engine.entry-point.ts';

import * as compatibilitySubpath from './compatibility.entry-point.ts';
import { throwingTest } from './compatibility.entry-point.ts';
import * as rootSubpath from './test.entry-point.ts';

type FailOutcome = Extract<
    Awaited<ReturnType<typeof execute>>['perTest'][number]['outcome'],
    { readonly kind: 'fail'; }
>;
type PlannedCase = TestPlan['discoveredCases'][number];

const invokeThrowingTest = throwingTest as (...parameters: readonly unknown[]) => unknown;

async function executeAuthoredNode(testCase: TestCase): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        children: [ testCase ],
        annotations: {},
        controls: {},
        title: 'root'
    })));
}

function firstFailedOutcome(result: Awaited<ReturnType<typeof execute>>): FailOutcome {
    const testResult = result.perTest[0];

    if (testResult === undefined || testResult.outcome?.kind !== 'fail') {
        throw new TypeError('Expected failing test result.');
    }

    return testResult.outcome;
}

const assertPlannedCompatibilityCase = defineCompositeAssertion({
    name: 'planned compatibility case',
    assert(check, plannedCase: PlannedCase | undefined) {
        if (plannedCase === undefined) {
            return check.defined(plannedCase);
        }
        return check.group([
            check.equal(plannedCase.testFamily, null),
            check.deepEqual(plannedCase.annotations.tags, [ 'compatibility' ]),
            check.equal(plannedCase.controls.timeoutMilliseconds, 50)
        ]);
    }
});

export const testNode = suite('Compatibility entry point', [
    test('@overkill-dev/test/compatibility exposes throwingTest only', function (scope) {
        scope.assert(
            defineCompositeAssertion({
                name: '@overkill-dev/test/compatibility exposes throwingTest only',
                assert(check) {
                    return check.group([
                        check.deepEqual(Object.keys(compatibilitySubpath), [ 'throwingTest' ]),
                        check.equal(Object.hasOwn(rootSubpath, 'throwingTest'), false)
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test(
        '@overkill-dev/test/compatibility throwingTest() creates neutral tests',
        async function (scope) {
            const testCase = throwingTest({
                annotations: { tags: [ 'compatibility' ] },
                body(testScope) {
                    testScope.assert.equal(1, 1);
                },
                controls: { timeoutMilliseconds: 50 },
                title: 'passes'
            });
            const plan = createTestPlan(createRoot({
                annotations: {},
                children: [ testCase ],
                controls: {},
                title: 'root'
            }));
            const result = await execute(plan);
            const plannedCase = plan.discoveredCases[0];

            scope.assert.equal(ownsTestNode(testCase), true);
            scope.assert.partialDeepEqual(testCase.execution, { kind: 'body', bodyMode: 'throwing' });

            scope.assert(assertPlannedCompatibilityCase, plannedCase);
            scope.assert.equal(result.summary.passed, 1);

            return scope.assert.collect();
        }
    ),
    test('@overkill-dev/test/compatibility treats normal completion as success', async function (scope) {
        const result = await executeAuthoredNode(throwingTest('passes', function noAssertions() {
            return undefined;
        }));

        scope.assert(
            defineCompositeAssertion({
                name: '@overkill-dev/test/compatibility treats normal completion as success',
                assert(check) {
                    return check.group([
                        check.equal(result.summary.passed, 1),
                        check.equal(result.summary.failed, 0)
                    ]);
                }
            })
        );

        return scope.assert.collect();
    }),
    test(
        '@overkill-dev/test/compatibility reports Node AssertionError as an assertion failure',
        async function (scope) {
            const result = await executeAuthoredNode(throwingTest('fails', function fails() {
                assert.equal(1, 2, 'wrong count');
            }));
            const outcome = firstFailedOutcome(result);
            const failure = outcome.failures[0];

            scope.assert.equal(failure.kind, 'assertion');

            return scope.assert.collect();
        }
    ),
    test('@overkill-dev/test/compatibility validates unsupported authoring forms', function (scope) {
        scope.assert(
            defineCompositeAssertion({
                name: '@overkill-dev/test/compatibility validates unsupported authoring forms',
                assert(check) {
                    return check.group([
                        check.throws(function createThrowingTestWithWrongArity() {
                            invokeThrowingTest();
                        }, {
                            message:
                                'throwingTest() requires (title, body) or ({ title, annotations?, controls?, body }).'
                        }),
                        check.throws(function createThrowingTestWithInvalidBody() {
                            invokeThrowingTest('passes', null);
                        }, { message: 'Test case body must be a function.' })
                    ]);
                }
            })
        );
        const captureCase = throwingTest({
            body() {
                return undefined;
            },
            controls: { capture: 'live' },
            title: 'captures'
        });

        scope.assert.deepEqual(captureCase.controls, { capture: 'live' });

        return scope.assert.collect();
    })
]);
