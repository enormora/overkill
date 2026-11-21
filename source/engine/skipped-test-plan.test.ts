import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

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

const assertSkippedPlan = defineCompositeAssertion({
    name: 'skipped plan',
    assert(check, testPlan: TestPlan) {
        const plannedCase = testPlan.cases[0];
        if (plannedCase === undefined || plannedCase === null) {
            return check.defined(plannedCase);
        }
        return check.group([
            check.deepEqual(plannedCase.id, {
                file: null,
                params: null,
                suite: [],
                title: 'conditional'
            }),
            check.deepEqual(plannedCase.execution, {
                kind: 'skip',
                reason: 'unsupported platform'
            }),
            check.deepEqual(plannedCase.annotations.tags, [ 'inherited', 'conditional' ]),
            check.equal(testPlan.defined, 1),
            check.deepEqual(testPlan.discoveredCases, testPlan.cases)
        ]);
    }
});

export const testNode = suite('Skipped test plan', [
    test('expands skipped test cases as leaf cases', function (scope) {
        const engine = createEngine();

        scope.assert(assertSkippedPlan, createSkippedPlan(engine));

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
