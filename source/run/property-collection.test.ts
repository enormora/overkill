import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';
import { test as subjectTest, suite as subjectSuite } from '../packages/test/test.entry-point.ts';

import {
    stampTestNodeFamily,
    type TestNode as SubjectTestNode,
    type TestPlan,
    createRoot,
    createTestPlan,
    createTestCase,
    createSkippedTestCase,
    ownsTestNode
} from '../packages/engine/engine.entry-point.ts';

import { property, withProperties } from '../packages/test/property.entry-point.ts';
import { defaultPropertyPolicy, resolvePropertyPolicy } from '../engine/property-policy.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { resolveTestPlanCollectionPolicy } from './run-selection.ts';
import {
    resolveTestPlanPropertyPolicy,
    testCasePropertyPolicy,
    assertAssignedPropertyPolicies,
    assertCollectedPropertyPolicies,
    testCasePropertySummary
} from './property-collection.ts';

const collectionPolicy = {
    testFamily: 'property',
    propertyPolicy: defaultPropertyPolicy,
    timeoutMilliseconds: 1000
} as const;

function planFor(node: SubjectTestNode): TestPlan {
    return createTestPlan(createRoot({ annotations: {}, controls: {}, title: 'root', children: [ node ] }));
}

function unexpectedBody(): never {
    throw new Error('Property bodies must not execute during collection.');
}

export const testNode: TestNode = suite('property collection', [
    test(
        'engine collection rejects unsupported property families from JavaScript callers',
        function (scope) {
            const root = createRoot({
                annotations: {},
                controls: {},
                title: 'invalid policy',
                children: [ subjectTest('ordinary', unexpectedBody) ]
            });
            scope.assert.throws(function invalidFamilyPolicy() {
                Reflect.apply(createTestPlan, undefined, [ root, {
                    runtimeMatrices: true,
                    benchmarkCalibration: false,
                    property: { testFamily: 'microtest', policy: defaultPropertyPolicy, timeoutMilliseconds: 1000 }
                } ]);
            }, { message: 'Property collection requires a property or integration family.' });
            return scope.assert.collect();
        }
    ),

    test('rejects unsupported property test families from JavaScript callers', function (scope) {
        scope.assert.throws(function invalidFamily() {
            Reflect.apply(property, undefined, [ {
                title: 'invalid family',
                testFamily: 'microtest',
                generator: unexecutedGenerator<number>(),
                test: unexpectedBody
            } ]);
        }, { message: 'Property cases require a property or integration test family.' });
        return scope.assert.collect();
    }),
    test(
        'integration property policy preserves ordinary capture controls and resolves property budgets',
        function (scope: TestScope) {
            const node = subjectSuite('integration', [
                createTestCase({
                    annotations: {},
                    controls: { capture: 'buffered' },
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: 'ordinary integration',
                    body: unexpectedBody
                }),
                property({
                    testFamily: 'integration',
                    title: 'project property',
                    generator: unexecutedGenerator<number>(),
                    test: unexpectedBody
                })
            ]);
            const policy = {
                ...collectionPolicy,
                testFamily: 'integration',
                propertyPolicy: { ...defaultPropertyPolicy, newTrials: 7 }
            } as const;
            const resolved = createTestPlan(
                createRoot({
                    annotations: {},
                    controls: {},
                    title: 'integration root',
                    children: [ node ]
                }),
                {
                    runtimeMatrices: true,
                    benchmarkCalibration: false,
                    property: {
                        testFamily: 'integration',
                        policy: policy.propertyPolicy,
                        timeoutMilliseconds: policy.timeoutMilliseconds
                    }
                }
            );
            const generated = resolved.cases[1];
            scope.require.defined(generated);
            assertCollectedPropertyPolicies(collectedRunPlanFromTestPlan(resolved), policy);
            scope.assert.equal(resolved.cases[0].controls.capture, 'buffered');
            scope.assert.equal(generated.testFamily, 'integration');
            scope.assert.equal(testCasePropertyPolicy(generated)?.newTrials, 7);
            return scope.assert.collect();
        }
    ),
    test('rejects missing profile policy before collection', function (scope) {
        const plan = planFor(subjectTest('ordinary', unexpectedBody));
        scope.assert.throws(function missingPolicy() {
            resolveTestPlanCollectionPolicy(plan, {
                testFamily: 'property',
                propertyPolicy: null,
                timeoutMilliseconds: 1000
            });
        }, { message: 'Property collection requires profile policy.' });
        return scope.assert.collect();
    }),
    test('rejects malformed property declarations at the policy boundary', function (scope) {
        for (
            const declaration of [ null, { kind: 'property', settingsDeclarations: [] }, {
                kind: 'unknown',
                settingsDeclarations: [ { kind: 'profile-default' } ]
            } ]
        ) {
            scope.assert.throws(function collectMalformedDeclaration() {
                Reflect.apply(resolvePropertyPolicy, undefined, [ defaultPropertyPolicy, declaration ]);
            }, { message: 'Property requires a valid collected declaration.' });
        }
        return scope.assert.collect();
    }),
    test(
        'resolves mixed ordinary and property cases without invoking their bodies',
        function (scope: TestScope) {
            const plan = planFor(subjectSuite('mixed', [
                subjectTest('ordinary', unexpectedBody),
                property({
                    title: 'law',
                    generator: unexecutedGenerator<number>(),
                    test: unexpectedBody,
                    settings: { maxWork: 50 }
                })
            ]));
            const resolved = resolveTestPlanPropertyPolicy(plan, collectionPolicy);
            const propertyCase = resolved.cases[1];
            scope.require.defined(propertyCase);
            scope.assert.equal(resolved.cases.length, 2);
            scope.assert.equal(testCasePropertyPolicy(resolved.cases[0]), null);
            scope.assert.equal(testCasePropertySummary(resolved.cases[0]), null);
            scope.assert.equal(testCasePropertyPolicy(propertyCase)?.maxWork, 50);
            return scope.assert.collect();
        }
    ),
    test('rejects repeated assignments and assignments for another work identity', function (scope) {
        const plan = resolveTestPlanPropertyPolicy(
            planFor(property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody })),
            collectionPolicy
        );
        const assignment = { work: plan.cases[0].workId, policy: defaultPropertyPolicy };
        scope.assert.throws(function assignRepeatedWork() {
            assertAssignedPropertyPolicies(plan, [ assignment, assignment ]);
        }, { message: 'Property policy changed between collection and execution.' });
        scope.assert.throws(function assignAnotherWorkIdentity() {
            assertAssignedPropertyPolicies(plan, [ {
                ...assignment,
                work: { ...assignment.work, case: { ...assignment.work.case, title: 'another law' } }
            } ]);
        }, { message: 'Property policy changed between collection and execution.' });
        return scope.assert.collect();
    }),
    test('rejects bodyless policy that differs from its collected declaration', function (scope: TestScope) {
        const plan = resolveTestPlanPropertyPolicy(
            planFor(property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody })),
            collectionPolicy
        );
        const collected = collectedRunPlanFromTestPlan(plan);
        const file = collected.discoveredFiles[0];
        scope.require.defined(file);
        const testCase = file.cases[0];
        scope.require.defined(testCase);
        const propertySummary = testCase.property;
        scope.require.defined(propertySummary);
        scope.assert.throws(function collectChangedBodylessPolicy() {
            assertCollectedPropertyPolicies(
                {
                    ...collected,
                    discoveredFiles: [ {
                        ...file,
                        cases: [ {
                            ...testCase,
                            property: { ...propertySummary, policy: { ...propertySummary.policy, maxWork: 1 } }
                        } ]
                    } ]
                },
                collectionPolicy
            );
        }, { message: 'Collected property policy does not match profile and declaration settings.' });
        return scope.assert.collect();
    }),
    test('rejects authored capture controls before selection', function (scope) {
        const plan = planFor(createTestCase({
            title: 'captured',
            annotations: {},
            controls: { capture: 'buffered' },
            definitionLocations: [ { kind: 'unknown' } ],
            body: withProperties(unexpectedBody)
        }));
        scope.assert.throws(function collectAuthoredCapture() {
            resolveTestPlanPropertyPolicy(plan, collectionPolicy);
        }, { message: /authored capture controls/ });
        return scope.assert.collect();
    }),
    test('rejects invalid case deadlines and permits the profile deadline', function (scope) {
        for (const timeoutMilliseconds of [ 0, -1, 1.5, 1001 ]) {
            const plan = planFor(createTestCase({
                title: 'invalid deadline',
                annotations: {},
                controls: { timeoutMilliseconds },
                definitionLocations: [ { kind: 'unknown' } ],
                body: withProperties(unexpectedBody)
            }));
            scope.assert.throws(function collectInvalidDeadline() {
                resolveTestPlanPropertyPolicy(plan, collectionPolicy);
            }, { message: /expected positive safe integer <= 1000/ });
        }
        const plan = planFor(createTestCase({
            title: 'profile deadline',
            annotations: {},
            controls: { timeoutMilliseconds: 1000 },
            definitionLocations: [ { kind: 'unknown' } ],
            body: withProperties(unexpectedBody)
        }));
        scope.assert.equal(resolveTestPlanPropertyPolicy(plan, collectionPolicy).cases.length, 1);
        return scope.assert.collect();
    }),
    test('requires declarations for executable property stamps and permits skipped cases', function (scope) {
        const missing = subjectTest('missing declaration', unexpectedBody);
        stampTestNodeFamily(missing, 'property');
        scope.assert.throws(function collectMissingDeclaration() {
            resolveTestPlanPropertyPolicy(planFor(missing), collectionPolicy);
        }, { message: /requires a collected property declaration/ });
        const skipped = createSkippedTestCase({
            title: 'skipped',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            reason: 'later'
        });
        stampTestNodeFamily(skipped, 'property');
        const resolved = resolveTestPlanPropertyPolicy(planFor(skipped), collectionPolicy);
        scope.assert.equal(testCasePropertyPolicy(resolved.cases[0]), null);
        scope.assert.equal(testCasePropertySummary(resolved.cases[0]), null);
        return scope.assert.collect();
    }),
    test('rejects unresolved policy when creating runner summaries', function (scope) {
        const plan = planFor(
            property({ title: 'unresolved', generator: unexecutedGenerator<number>(), test: unexpectedBody })
        );
        scope.assert.throws(function readUnresolvedPolicy() {
            testCasePropertyPolicy(plan.cases[0]);
        }, { message: 'Property execution requires resolved collection policy.' });
        scope.assert.throws(function readUnresolvedSummary() {
            testCasePropertySummary(plan.cases[0]);
        }, { message: 'Property collection requires resolved policy.' });
        return scope.assert.collect();
    }),
    test('collects first-class policy without generation and preserves one case', function (scope: TestScope) {
        const settings = { newTrials: 200, maxShrinkWork: 0 };
        const plan = planFor(
            property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody, settings })
        );
        settings.newTrials = 999;
        const resolved = resolveTestPlanPropertyPolicy(plan, collectionPolicy);
        scope.assert.equal(resolved.cases.length, 1);
        const policy = testCasePropertyPolicy(resolved.cases[0]);
        scope.require.defined(policy);
        scope.assert.deepEqual(policy, {
            ...defaultPropertyPolicy,
            newTrials: 200,
            maxShrinkWork: 0
        });
        scope.assert.equal(
            plan.cases[0].execution.kind === 'body' && plan.cases[0].execution.bodyMode === 'property' && plan
                .cases[0]
                .execution
                .policy
                .kind,
            'unresolved'
        );
        return scope.assert.collect();
    }),
    test(
        'nested wrappers inherit defaults and validate reconfiguration during collection',
        function (scope) {
            const body = withProperties(unexpectedBody, { maxWork: 50 });
            const plan = planFor(subjectTest('nested', withProperties(body)));
            const resolved = resolveTestPlanPropertyPolicy(plan, collectionPolicy);
            scope.assert.equal(testCasePropertyPolicy(resolved.cases[0])?.maxWork, 50);
            const conflict = planFor(subjectTest('conflict', withProperties(body, { maxWork: 100 })));
            scope.assert.throws(function collectReconfiguredProperty() {
                resolveTestPlanPropertyPolicy(conflict, collectionPolicy);
            }, { message: /cannot reconfigure/ });
            return scope.assert.collect();
        }
    ),
    test('rejects invalid settings on discovered cases excluded from selection', function (scope) {
        const plan = planFor(
            property({
                title: 'invalid',
                generator: unexecutedGenerator<number>(),
                test: unexpectedBody,
                settings: { maxWork: -1 }
            })
        );
        const selected = planFor(subjectTest('selected', function (sample) {
            return sample.assert.collect();
        }));
        scope.assert.throws(function collectInvalidDiscoveredProperty() {
            resolveTestPlanPropertyPolicy({ ...plan, cases: selected.cases }, collectionPolicy);
        }, { message: /Invalid property policy/ });
        return scope.assert.collect();
    }),
    test(
        'rejects malformed explicit settings instead of silently inheriting defaults',
        function (scope) {
            for (const settings of [ null, true, [], 1, 'invalid' ]) {
                const node: unknown = Reflect.apply(property, undefined, [ {
                    title: 'invalid settings',
                    generator: unexecutedGenerator<number>(),
                    test: unexpectedBody,
                    settings
                } ]);
                if (!ownsTestNode(node)) {
                    throw new TypeError('Expected an engine-owned test node.');
                }
                scope.assert.throws(function validateMalformedSettings() {
                    resolveTestPlanPropertyPolicy(planFor(node), collectionPolicy);
                }, { message: /Invalid property policy/ });
            }
            return scope.assert.collect();
        }
    ),
    test('transports resolved policy and detects re-import drift', function (scope: TestScope) {
        const plan = resolveTestPlanPropertyPolicy(
            planFor(property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody })),
            collectionPolicy
        );
        const collected = collectedRunPlanSchema.parse(collectedRunPlanFromTestPlan(plan));
        const policy = collected.files[0]?.cases[0]?.property?.policy;
        scope.require.defined(policy);
        scope.assert.deepEqual(policy, defaultPropertyPolicy);
        assertCollectedPropertyPolicies(collected, collectionPolicy);
        assertAssignedPropertyPolicies(plan, [ { work: plan.cases[0].workId, policy: defaultPropertyPolicy } ]);
        scope.assert.throws(function checkMissingAssignment() {
            assertAssignedPropertyPolicies(plan, []);
        }, { message: /changed between collection and execution/ });
        scope.assert.throws(function checkChangedAssignment() {
            assertAssignedPropertyPolicies(plan, [ {
                work: plan.cases[0].workId,
                policy: { ...defaultPropertyPolicy, maxWork: 1 }
            } ]);
        }, { message: /changed between collection and execution/ });
        return scope.assert.collect();
    })
]);
