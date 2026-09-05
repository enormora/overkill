import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestBody,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';

function passingBody(scope: OverkillScope): ReturnType<TestBody> {
    scope.assert.true(true);

    return scope.assert.collect();
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/test-plan-authoring-rules.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createTestPlan() rejects reachable tables with fewer than two cases',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const emptyTableRoot = engine.createRoot({
                    children: [
                        engine.createTable({
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
            title: 'createTestPlan() rejects duplicate sibling titles',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            body: passingBody,
                            metadata: {},
                            title: 'same'
                        }),
                        engine.createTestCase({
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
            title: 'createTestPlan() rejects duplicate table case titles',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createTestEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTable({
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
