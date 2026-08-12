import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/test-plan.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'createTestPlan() expands suites and tables into executable cases',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true, { message: 'passes' });
                                return testScope.assert.collect();
                            },
                            metadata: { local: true },
                            name: 'first'
                        }),
                        engine.createTable({
                            cases: [
                                {
                                    body(testScope) {
                                        testScope.assert.true(true, { message: 'row passes' });
                                        return testScope.assert.collect();
                                    },
                                    metadata: { row: 1 },
                                    name: 'row 1',
                                    parameters: { value: 1 }
                                }
                            ],
                            metadata: { table: true },
                            name: 'rows'
                        })
                    ],
                    metadata: { inherited: true },
                    name: 'root'
                });

                const testPlan = engine.createTestPlan(root);

                const comparableTestCases = testPlan.cases.map(function toComparableTestCase(testCase) {
                    return {
                        id: testCase.id,
                        metadata: testCase.metadata,
                        suitePath: testCase.suitePath
                    };
                });
                const testCaseShape = plainDataShape(comparableTestCases);

                scope.assert.deepEqual(
                    testCaseShape,
                    [
                        {
                            id: { file: null, name: 'first', params: null, suite: [] },
                            metadata: { inherited: true, local: true },
                            suitePath: []
                        },
                        {
                            id: { file: null, name: 'row 1', params: null, suite: [ 'rows' ] },
                            metadata: { inherited: true, row: 1, table: true },
                            suitePath: [ 'rows' ]
                        }
                    ]
                );
                scope.assert.deepEqual(testPlan.discoveredCases, testPlan.cases);
                scope.assert.equal(testPlan.defined, 2);
                scope.assert.deepEqual(testPlan.orphans, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() reports constructed nodes that do not reach the root as orphans',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const reached = engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'reached'
                });
                engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'unused test'
                });
                engine.createSuite({
                    children: [],
                    metadata: {},
                    name: 'unused suite'
                });
                const root = engine.createRoot({
                    children: [ reached ],
                    metadata: {},
                    name: 'root'
                });

                const testPlan = engine.createTestPlan(root);

                scope.assert.equal(testPlan.defined, 3);
                scope.assert.deepEqual(testPlan.orphans, [
                    { file: null, kind: 'test', name: 'unused test' },
                    { file: null, kind: 'suite', name: 'unused suite' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects reachable empty suites',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [],
                    metadata: {},
                    name: 'root'
                });

                scope.assert.throws(function createPlanWithEmptySuite() {
                    engine.createTestPlan(root);
                }, { message: 'Root must contain at least one child: root.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects reachable empty nested suites',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createSuite({
                            children: [
                                engine.createSuite({
                                    children: [],
                                    metadata: {},
                                    name: 'empty'
                                })
                            ],
                            metadata: {},
                            name: 'parent'
                        })
                    ],
                    metadata: {},
                    name: 'root'
                });

                scope.assert.throws(function createPlanWithEmptySuite() {
                    engine.createTestPlan(root);
                }, { message: 'Suite must contain at least one child: parent > empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects reachable empty tables',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTable({
                            cases: [],
                            metadata: {},
                            name: 'rows'
                        })
                    ],
                    metadata: {},
                    name: 'root'
                });

                scope.assert.throws(function createPlanWithEmptyTable() {
                    engine.createTestPlan(root);
                }, { message: 'Table must contain at least one case: rows.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects duplicate full case identities',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true, { message: 'passes' });
                                return testScope.assert.collect();
                            },
                            metadata: {},
                            name: 'same'
                        }),
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true, { message: 'passes' });
                                return testScope.assert.collect();
                            },
                            metadata: {},
                            name: 'same'
                        })
                    ],
                    metadata: {},
                    name: 'root'
                });

                scope.assert.throws(function createPlanWithDuplicateIds() {
                    engine.createTestPlan(root);
                }, { message: 'Duplicate test case identity: same.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects non-root test nodes',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                });

                scope.assert.throws(function createPlanFromTestCase() {
                    engine.createTestPlan(testCase as never);
                }, { message: 'Test plan root must be an engine-created TestRoot value.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects roots from another engine instance',
            metadata: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const root = firstEngine.createRoot({
                    children: [],
                    metadata: {},
                    name: 'root'
                });

                scope.assert.throws(function createForeignPlan() {
                    secondEngine.createTestPlan(root);
                }, { message: 'Test plan root must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
