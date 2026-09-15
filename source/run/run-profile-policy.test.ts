import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    type TestCase,
    type TestControlsInput,
    type TestScope as OverkillScope
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
    return createOverkillTestCase({
        annotations: {},
        body(scope: OverkillScope) {
            scope.assert.true(true);

            return scope.assert.collect();
        },
        controls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: caseTitle
    });
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-profile-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertTestPlanCasesMatchProfilePolicy() rejects selected microtest capture controls',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const testPlan = testPlanForCase(testCaseWithControls('captures', { capture: 'live' }));

                scope.assert.throws(function assertCaptureControls() {
                    assertTestPlanCasesMatchProfilePolicy(testPlan, defaultMicrotestProfile());
                }, {
                    message: microtestCaptureControlsError,
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertTestPlanCasesMatchProfilePolicy() validates selected timeout controls',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'assertCollectedRunPlanCasesMatchProfilePolicy() validates selected cases only',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
