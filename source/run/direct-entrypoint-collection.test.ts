import {
    createSuite,
    createTestCase,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import type { TestNode } from '../engine/test-node.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { assertDirectEntrypointCollectionMatches } from './direct-entrypoint-collection.ts';

function passingTest(title: string): TestNode {
    return createTestCase({
        annotations: {},
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        },
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title
    });
}

function testPlan(title: string): TestPlan {
    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file: '/project/direct.test.ts', testNode: passingTest(title) } ],
        root: { annotations: {}, controls: {}, title: '/project' }
    });
}

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                const expected = testPlan('passes');

                assertDirectEntrypointCollectionMatches(expected, collectedRunPlanFromTestPlan(expected));
                scope.assert.true(true);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint collection accepts equivalent normalized plans'
        }),
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                scope.assert.throws(function compareDifferentDirectPlans() {
                    assertDirectEntrypointCollectionMatches(
                        testPlan('expected'),
                        collectedRunPlanFromTestPlan(testPlan('exported'))
                    );
                }, {
                    message: /runIfMain\(\) argument does not match/u,
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint collection rejects different normalized plans'
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/direct-entrypoint-collection.test.ts'
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
