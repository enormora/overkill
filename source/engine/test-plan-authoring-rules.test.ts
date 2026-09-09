import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBody,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';

function passingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/test-plan-authoring-rules.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects reachable tables with fewer than two cases',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const emptyTableRoot = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            cases: [],
                            annotations: {},
                            controls: {},
                            title: 'empty rows'
                        })
                    ],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });
                const singleRowTableRoot = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            cases: [
                                {
                                    body: passingBody,
                                    annotations: {},
                                    controls: {},
                                    parameters: 'only',
                                    title: 'only row'
                                }
                            ],
                            annotations: {},
                            controls: {},
                            title: 'single row'
                        })
                    ],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });

                scope.assert.throws(function createPlanWithEmptyTable() {
                    engine.createTestPlan(emptyTableRoot);
                }, { message: 'Table must contain at least two cases: empty rows.' });
                scope.assert.throws(function createPlanWithSingleRowTable() {
                    engine.createTestPlan(singleRowTableRoot);
                }, { message: 'Table must contain at least two cases: single row.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects duplicate sibling titles',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            body: passingBody,
                            annotations: {},
                            controls: {},
                            title: 'same'
                        }),
                        engine.createTestCase({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            body: passingBody,
                            annotations: {},
                            controls: {},
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects reachable empty nested suites',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createSuite({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            children: [
                                engine.createSuite({
                                    definitionLocations: [ { kind: 'unknown' as const } ],
                                    children: [],
                                    annotations: {},
                                    controls: {},
                                    title: 'empty'
                                })
                            ],
                            annotations: {},
                            controls: {},
                            title: 'parent'
                        })
                    ],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });

                scope.assert.throws(function createPlanWithEmptySuite() {
                    engine.createTestPlan(root);
                }, { message: 'Suite must contain at least one child: parent > empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects duplicate table case titles',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            cases: [
                                {
                                    body: passingBody,
                                    annotations: {},
                                    controls: {},
                                    parameters: { value: 1 },
                                    title: 'same'
                                },
                                {
                                    body: passingBody,
                                    annotations: {},
                                    controls: {},
                                    parameters: { value: 2 },
                                    title: 'same'
                                }
                            ],
                            annotations: {},
                            controls: {},
                            title: 'rows'
                        })
                    ],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });

                scope.assert.throws(function createPlanWithDuplicateTableCaseTitles() {
                    engine.createTestPlan(root);
                }, { message: 'Duplicate test node title under rows: same.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
