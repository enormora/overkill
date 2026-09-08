import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { Engine } from './engine.ts';
import type { TestPlan } from './test-plan.ts';

function createSkippedPlan(engine: Engine): TestPlan {
    const root = engine.createRoot({
        children: [
            engine.createSkippedTestCase({
                definitionLocations: [ { kind: 'unknown' as const } ],
                metadata: { tags: [ 'conditional' ] },
                reason: 'unsupported platform',
                title: 'conditional'
            })
        ],
        metadata: { tags: [ 'inherited' ] },
        title: 'root'
    });

    return engine.createTestPlan(root);
}

function assertSkippedPlan(scope: OverkillScope, testPlan: TestPlan): void {
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
    scope.assert.deepEqual(plannedCase.metadata.tags, [ 'inherited', 'conditional' ]);
    scope.assert.equal(testPlan.defined, 1);
    scope.assert.deepEqual(testPlan.discoveredCases, testPlan.cases);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/skipped-test-plan.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() expands skipped test cases as leaf cases',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                assertSkippedPlan(scope, createSkippedPlan(engine));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects duplicate body and skipped case titles',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            body(testScope) {
                                testScope.assert.true(true, { message: 'passes' });
                                return testScope.assert.collect();
                            },
                            metadata: {},
                            title: 'same'
                        }),
                        engine.createSkippedTestCase({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            metadata: {},
                            reason: 'not needed',
                            title: 'same'
                        })
                    ],
                    metadata: {},
                    title: 'root'
                });

                scope.assert.throws(function createPlanWithDuplicateTitles() {
                    engine.createTestPlan(root);
                }, { message: 'Duplicate test node title under root: same.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
