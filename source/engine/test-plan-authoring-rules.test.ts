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

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/engine/test-plan-authoring-rules.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'createTestPlan() rejects reachable tables with fewer than two cases',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const emptyTableRoot = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { column: null, file: '', line: null } ],
                            cases: [],
                            metadata: {},
                            title: 'empty rows'
                        })
                    ],
                    metadata: {},
                    title: 'root'
                });
                const singleRowTableRoot = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { column: null, file: '', line: null } ],
                            cases: [
                                {
                                    body: passingBody,
                                    metadata: {},
                                    parameters: 'only',
                                    title: 'only row'
                                }
                            ],
                            metadata: {},
                            title: 'single row'
                        })
                    ],
                    metadata: {},
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
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'createTestPlan() rejects duplicate sibling titles',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            definitionLocations: [ { column: null, file: '', line: null } ],
                            body: passingBody,
                            metadata: {},
                            title: 'same'
                        }),
                        engine.createTestCase({
                            definitionLocations: [ { column: null, file: '', line: null } ],
                            body: passingBody,
                            metadata: {},
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'createTestPlan() rejects duplicate table case titles',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTable({
                            definitionLocations: [ { column: null, file: '', line: null } ],
                            cases: [
                                {
                                    body: passingBody,
                                    metadata: {},
                                    parameters: { value: 1 },
                                    title: 'same'
                                },
                                {
                                    body: passingBody,
                                    metadata: {},
                                    parameters: { value: 2 },
                                    title: 'same'
                                }
                            ],
                            metadata: {},
                            title: 'rows'
                        })
                    ],
                    metadata: {},
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

await runTestFileIfMain(import.meta, testSuite);
