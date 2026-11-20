import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { subjectTestNode } from '../test-support/create-test-engine.ts';

import {
    type TestCase,
    type TestControlsInput,
    createRoot,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import {
    assertCollectedRunPlanCasesMatchProfilePolicy,
    assertTestPlanCasesMatchProfilePolicy
} from './run-selection.ts';

const microtestCaptureControlsError = 'Run profile "microtest" cannot run test cases with authored capture controls.';
const longTimeoutError =
    'Run profile "microtest" cannot run test case timeoutMilliseconds 51; expected positive safe integer <= 50.';
const fractionalTimeoutError =
    'Run profile "microtest" cannot run test case timeoutMilliseconds 1.5; expected positive safe integer <= 50.';

function testCaseWithControls(caseTitle: string, controls: TestControlsInput): TestCase {
    return subjectTestNode(test({
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        },
        controls,
        title: caseTitle
    }));
}

function testPlanForChildren(children: readonly TestCase[]): TestPlan {
    return createTestPlan(createRoot({
        annotations: {},
        children,
        controls: {},
        title: 'root'
    }));
}

function testPlanForCase(testCase: TestCase): TestPlan {
    return testPlanForChildren([ testCase ]);
}

export const testNode: TestNode = suite('Run profile policy', [
    test(
        'assertTestPlanCasesMatchProfilePolicy() rejects selected microtest capture controls',
        function (scope) {
            const testPlan = testPlanForCase(testCaseWithControls('captures', { capture: 'live' }));

            scope.assert.throws(function assertCaptureControls() {
                assertTestPlanCasesMatchProfilePolicy(testPlan, defaultMicrotestProfile());
            }, {
                message: microtestCaptureControlsError,
                name: 'RunCollectionError'
            });

            return scope.assert.collect();
        }
    ),
    test(
        'assertTestPlanCasesMatchProfilePolicy() validates selected timeout controls',
        function (scope) {
            const profile = defaultMicrotestProfile({
                timeouts: { hardMilliseconds: 100, softMilliseconds: 50 }
            });

            assertTestPlanCasesMatchProfilePolicy(
                testPlanForCase(testCaseWithControls('short timeout', { timeoutMilliseconds: 50 })),
                profile
            );
            scope.assert.throws(function assertLongTimeout() {
                assertTestPlanCasesMatchProfilePolicy(
                    testPlanForCase(testCaseWithControls('long timeout', { timeoutMilliseconds: 51 })),
                    profile
                );
            }, { message: longTimeoutError, name: 'RunCollectionError' });
            scope.assert.throws(function assertFractionalTimeout() {
                assertTestPlanCasesMatchProfilePolicy(
                    testPlanForCase(testCaseWithControls('fractional timeout', { timeoutMilliseconds: 1.5 })),
                    profile
                );
            }, { message: fractionalTimeoutError, name: 'RunCollectionError' });

            return scope.assert.collect();
        }
    ),
    test(
        'assertCollectedRunPlanCasesMatchProfilePolicy() validates selected cases only',
        function (scope: TestScope) {
            const validCase = testCaseWithControls('valid', {});
            const invalidCase = testCaseWithControls('invalid', { capture: 'live' });
            const allCasesPlan = testPlanForChildren([ validCase, invalidCase ]);
            const selectedCase = allCasesPlan.cases[0];
            scope.require.defined(selectedCase);
            const selectedOnlyPlan = {
                ...allCasesPlan,
                cases: [ selectedCase ] as const
            };
            const collectedPlan = collectedRunPlanFromTestPlan(selectedOnlyPlan);

            assertCollectedRunPlanCasesMatchProfilePolicy(collectedPlan, defaultMicrotestProfile());
            scope.assert.equal(collectedPlan.files[0]?.cases.length, 1);

            return scope.assert.collect();
        }
    )
]);
