import assert from 'node:assert/strict';
import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    execute,
    ownsTestNode,
    type TestCase,
    type TestPlan,
    type TestScope as OverkillScope
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

function assertThrowingTestCase(scope: OverkillScope, testCase: TestCase): void {
    scope.assert.equal(ownsTestNode(testCase), true);
    scope.assert.equal(testCase.execution.kind, 'body');

    if (testCase.execution.kind === 'body') {
        scope.assert.equal(testCase.execution.bodyMode, 'throwing');
    }
}

function assertPlannedCompatibilityCase(scope: OverkillScope, plannedCase: PlannedCase): void {
    scope.assert.equal(plannedCase.testFamily, 'microtest');
    scope.assert.deepEqual(plannedCase.annotations.tags, [ 'compatibility' ]);
    scope.assert.equal(plannedCase.controls.timeoutMilliseconds, 50);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/compatibility-entry-point.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/compatibility exposes throwingTest only',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(Object.keys(compatibilitySubpath), [ 'throwingTest' ]);
                scope.assert.equal(Object.hasOwn(rootSubpath, 'throwingTest'), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/compatibility throwingTest() creates default microtests',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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

                scope.require.defined(plannedCase);
                assertThrowingTestCase(scope, testCase);
                assertPlannedCompatibilityCase(scope, plannedCase);
                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/compatibility treats normal completion as success',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeAuthoredNode(throwingTest('passes', function noAssertions() {
                    return undefined;
                }));

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/compatibility reports Node AssertionError as an assertion failure',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeAuthoredNode(throwingTest('fails', function fails() {
                    assert.equal(1, 2, 'wrong count');
                }));
                const outcome = firstFailedOutcome(result);
                const failure = outcome.failures[0];

                scope.assert.equal(failure.kind, 'assertion');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/compatibility validates unsupported authoring forms',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createThrowingTestWithWrongArity() {
                    invokeThrowingTest();
                }, {
                    message: 'throwingTest() requires (title, body) or ({ title, annotations?, controls?, body }).'
                });
                scope.assert.throws(function createThrowingTestWithInvalidBody() {
                    invokeThrowingTest('passes', null);
                }, { message: 'Test case body must be a function.' });
                scope.assert.throws(function createThrowingMicrotestWithCapture() {
                    invokeThrowingTest({
                        body() {
                            return undefined;
                        },
                        controls: { capture: 'live' },
                        title: 'captures'
                    });
                }, { message: 'Microtest authoring controls do not support capture mode.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
