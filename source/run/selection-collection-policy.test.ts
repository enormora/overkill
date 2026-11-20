import { type TestNode, suite, test } from '@overkill-dev/test';

import { createCollectedPlan } from '../test-support/worker-pool-execution-state.ts';

import {
    type TestNode as SubjectTestNode,
    type TestPlan,
    createRoot,
    createTestPlan,
    createTestCase,
    createSkippedTestCase
} from '../packages/engine/engine.entry-point.ts';

import { property } from '../packages/test/property.entry-point.ts';
import { unexecutedGenerator } from '../test-support/property-generator.ts';
import { assertCollectedRunPlanHasCases, resolveTestPlanCollectionPolicy } from './run-selection.ts';

const policy = { testFamily: 'integration', propertyPolicy: null, timeoutMilliseconds: 1000, replay: null } as const;
const metadata = {
    title: 'case',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;
function unexpectedBody(): never {
    throw new Error('Collection must not execute bodies.');
}
function planFor(node: SubjectTestNode): TestPlan {
    return createTestPlan(createRoot({ title: 'root', annotations: {}, controls: {}, children: [ node ] }));
}
export const testNode: TestNode = suite('collection policy admission', [
    test('rejects collected plans without selected cases', function (scope) {
        const plan = { ...createCollectedPlan(), files: [] };
        scope.assert.throws(function () {
            assertCollectedRunPlanHasCases(plan);
        }, { message: 'Run selection matched no test cases.' });
        return scope.assert.collect();
    }),
    test('preserves a recorded plan before current family admission', function (scope) {
        const plan = planFor(createTestCase({ ...metadata, body: unexpectedBody }));
        const recorded = {
            ...policy,
            testFamily: 'microtest' as const,
            replay: { kind: 'record' as const, plan: createCollectedPlan(), witness: null }
        };
        scope.assert.equal(resolveTestPlanCollectionPolicy(plan, recorded), plan);
        return scope.assert.collect();
    }),
    test('checks ordinary admission when replay is absent', function (scope) {
        const plan = planFor(createTestCase({ ...metadata, body: unexpectedBody }));
        scope.assert.equal(resolveTestPlanCollectionPolicy(plan, policy), plan);
        return scope.assert.collect();
    }),
    test('requires a profile policy for collected integration property declarations', function (scope) {
        const plan = planFor(
            property({
                title: 'declaration',
                testFamily: 'integration',
                generator: unexecutedGenerator<number>(),
                test: unexpectedBody
            })
        );
        scope.assert.throws(function () {
            resolveTestPlanCollectionPolicy(plan, policy);
        }, { message: 'Property collection requires profile policy.' });
        return scope.assert.collect();
    }),
    test('preserves ordinary integration cases when no property policy applies', function (scope) {
        const plan = planFor(createTestCase({ ...metadata, body: unexpectedBody }));
        scope.assert.equal(resolveTestPlanCollectionPolicy(plan, policy), plan);
        return scope.assert.collect();
    }),
    test('does not require property policy for intentionally skipped cases', function (scope) {
        const plan = planFor(createSkippedTestCase({ ...metadata, reason: 'intentional' }));
        scope.assert.equal(resolveTestPlanCollectionPolicy(plan, policy), plan);
        return scope.assert.collect();
    })
]);
