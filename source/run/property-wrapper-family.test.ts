import { suite, test, type TestScope } from '@overkill-dev/test';
import { test as subjectTest } from '../packages/test/test.entry-point.ts';
import { property, withProperties } from '../packages/test/property.entry-point.ts';
import {
    createRoot,
    createTestPlan,
    type TestNode as SubjectTestNode,
    type TestPlan
} from '../packages/engine/engine.entry-point.ts';
import { defaultPropertyPolicy } from '../engine/property-policy.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import type { EngineCaseBody } from '../test-support/create-test-engine.ts';
import { resolveTestPlanPropertyPolicy, testCasePropertyPolicy } from './property-collection.ts';

const collectionPolicy = {
    testFamily: 'integration',
    propertyPolicy: defaultPropertyPolicy,
    timeoutMilliseconds: 1000
} as const;
function unexpectedBody(): never {
    throw new Error('Property bodies must not execute during collection.');
}
function planFor(node: SubjectTestNode): TestPlan {
    return createTestPlan(createRoot({ annotations: {}, controls: {}, title: 'root', children: [ node ] }));
}
function integrationPropertyBody(): EngineCaseBody {
    const selected = planFor(property({
        testFamily: 'integration',
        title: 'project property',
        generator: unexecutedGenerator<number>(),
        test: unexpectedBody
    }))
        .cases[0];
    if (
        selected.execution.kind !== 'body' || selected.execution.bodyMode !== 'property' ||
        typeof selected.execution.body !== 'function'
    ) {
        throw new TypeError('Expected an executable property.');
    }
    return selected.execution.body;
}
export const testNode = suite('Integration property wrapper families', [
    test(
        'preserves the family and rejects conflicting settings',
        function (scope: TestScope) {
            const body = integrationPropertyBody();
            const policy = { ...collectionPolicy, testFamily: 'integration' } as const;
            const resolved = resolveTestPlanPropertyPolicy(
                planFor(subjectTest('wrapped', withProperties(body))),
                policy
            );
            const resolvedPolicy = testCasePropertyPolicy(resolved.cases[0]);
            scope.require.notNull(resolvedPolicy);
            scope.assert.equal(resolved.cases[0].testFamily, 'integration');
            scope.assert.deepEqual(resolvedPolicy, defaultPropertyPolicy);
            scope.assert.throws(function rejectReconfiguration() {
                resolveTestPlanPropertyPolicy(
                    planFor(subjectTest('configured', withProperties(body, { maxWork: 1 }))),
                    policy
                );
            }, { message: /withProperties\(\) cannot reconfigure/ });
            return scope.assert.collect();
        }
    )
]);
