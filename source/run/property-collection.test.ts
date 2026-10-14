import {
    createRoot,
    createTestPlan,
    ownsTestNode,
    type TestNode,
    type TestPlan,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { property, withProperties } from '../packages/test/property.entry-point.ts';
import { defaultPropertyPolicy } from '../config/property-policy.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import {
    resolveTestPlanPropertyPolicy,
    testCasePropertyPolicy,
    assertAssignedPropertyPolicies,
    assertCollectedPropertyPolicies
} from './property-collection.ts';

function planFor(node: TestNode): TestPlan {
    return createTestPlan(createRoot({ annotations: {}, controls: {}, title: 'root', children: [ node ] }));
}

function unexpectedBody(): never {
    throw new Error('Property bodies must not execute during collection.');
}

export const testNode = suite('property collection', [
    test('collects first-class policy without generation and preserves one case', function (scope: TestScope) {
        const settings = { newTrials: 200, maxShrinkWork: 0 };
        const plan = planFor(
            property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody, settings })
        );
        settings.newTrials = 999;
        const resolved = resolveTestPlanPropertyPolicy(plan, defaultPropertyPolicy, 1000);
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
        function (scope: TestScope) {
            const body = withProperties(unexpectedBody, { maxWork: 50 });
            const plan = planFor(test('nested', withProperties(body)));
            const resolved = resolveTestPlanPropertyPolicy(plan, defaultPropertyPolicy, 1000);
            scope.assert.equal(testCasePropertyPolicy(resolved.cases[0])?.maxWork, 50);
            const conflict = planFor(test('conflict', withProperties(body, { maxWork: 100 })));
            scope.assert.throws(function collectReconfiguredProperty() {
                resolveTestPlanPropertyPolicy(conflict, defaultPropertyPolicy, 1000);
            }, { message: /cannot reconfigure/ });
            return scope.assert.collect();
        }
    ),
    test('rejects invalid settings on discovered cases excluded from selection', function (scope: TestScope) {
        const plan = planFor(
            property({
                title: 'invalid',
                generator: unexecutedGenerator<number>(),
                test: unexpectedBody,
                settings: { maxWork: -1 }
            })
        );
        const selected = planFor(test('selected', function (sample) {
            return sample.assert.collect();
        }));
        scope.assert.throws(function collectInvalidDiscoveredProperty() {
            resolveTestPlanPropertyPolicy({ ...plan, cases: selected.cases }, defaultPropertyPolicy, 1000);
        }, { message: /Invalid property policy/ });
        return scope.assert.collect();
    }),
    test('rejects malformed explicit settings instead of silently inheriting defaults', function (scope: TestScope) {
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
                resolveTestPlanPropertyPolicy(planFor(node), defaultPropertyPolicy, 1000);
            }, { message: /Invalid property policy/ });
        }
        return scope.assert.collect();
    }),
    test('transports resolved policy and detects re-import drift', function (scope: TestScope) {
        const plan = resolveTestPlanPropertyPolicy(
            planFor(property({ title: 'law', generator: unexecutedGenerator<number>(), test: unexpectedBody })),
            defaultPropertyPolicy,
            1000
        );
        const collected = collectedRunPlanSchema.parse(collectedRunPlanFromTestPlan(plan));
        const policy = collected.files[0]?.cases[0]?.property?.policy;
        scope.require.defined(policy);
        scope.assert.deepEqual(policy, defaultPropertyPolicy);
        assertCollectedPropertyPolicies(collected, defaultPropertyPolicy, 1000);
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

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
