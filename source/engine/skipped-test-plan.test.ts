import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { TestPlan } from './test-plan.ts';

function createSkippedPlan(engine: Engine): TestPlan {
    const root = engine.createRoot({
        children: [
            engine.createSkippedTestCase({
                annotations: { tags: [ 'conditional' ] },
                controls: {},
                definitionLocations: [ { kind: 'unknown' as const } ],
                reason: 'unsupported platform',
                title: 'conditional'
            })
        ],
        annotations: { tags: [ 'inherited' ] },
        controls: {},
        title: 'root'
    });

    return engine.createTestPlan(root);
}

function assertSkippedPlan(scope: TestScope, testPlan: TestPlan): void {
    const plannedCase = testPlan.cases[0];

    scope.require.defined(plannedCase);
    scope.assert.deepEqual(plannedCase.id, {
        file: null,
        params: null,
        suite: [],
        title: 'conditional'
    });
    scope.assert.deepEqual(plannedCase.execution, {
        kind: 'skip',
        reason: 'unsupported platform'
    });
    scope.assert.deepEqual(plannedCase.annotations.tags, [ 'inherited', 'conditional' ]);
    scope.assert.equal(testPlan.defined, 1);
    scope.assert.deepEqual(testPlan.discoveredCases, testPlan.cases);
}

export const testNode: TestNode = suite('Skipped test plan', [
    test('expands skipped test cases as leaf cases', function (scope) {
        const engine = createEngine();

        assertSkippedPlan(scope, createSkippedPlan(engine));

        return scope.assert.collect();
    }),
    test('rejects duplicate body and skipped case titles', function (scope) {
        const engine = createEngine();
        const root = engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'same'
                }),
                engine.createSkippedTestCase({
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    reason: 'not needed',
                    title: 'same'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        });

        scope.assert.throws(function createPlanWithDuplicateTitles() {
            engine.createTestPlan(root);
        }, { message: 'Duplicate test node title under root: same.' });

        return scope.assert.collect();
    })
]);
