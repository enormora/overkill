import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { TestCaseOptions } from './test-node.ts';
import type { TestPlanFromTestFilesOptions } from './test-plan.ts';

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

function sourceLocationShape(fields: Readonly<Record<string, unknown>>): unknown {
    return {
        kind: 'unknown',
        ...fields
    };
}

function parameterIdentity(parameters: Readonly<Record<string, unknown>>): string {
    return JSON.stringify(serializeValue(parameters));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/test-plan.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() expands suites and tables into executable cases',
            annotations: {},
            controls: {},
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
                            annotations: { tags: [ 'local' ] },
                            controls: {},
                            title: 'first'
                        }),
                        engine.createTable({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            cases: [
                                {
                                    body(testScope) {
                                        testScope.assert.true(true, { message: 'row passes' });
                                        return testScope.assert.collect();
                                    },
                                    annotations: {},
                                    controls: {},
                                    title: 'row 1',
                                    parameters: { value: 1 }
                                },
                                {
                                    body(testScope) {
                                        testScope.assert.true(true, { message: 'row passes' });
                                        return testScope.assert.collect();
                                    },
                                    annotations: {},
                                    controls: {},
                                    title: 'row 2',
                                    parameters: { value: 2 }
                                }
                            ],
                            annotations: { tags: [ 'table' ] },
                            controls: {},
                            title: 'rows'
                        })
                    ],
                    annotations: { tags: [ 'inherited' ] },
                    controls: {},
                    title: 'root'
                });

                const testPlan = engine.createTestPlan(root);

                const comparableTestCases = testPlan.cases.map(function toComparableTestCase(testCase) {
                    return {
                        annotations: testCase.annotations,
                        controls: testCase.controls,
                        definitionLocations: testCase.definitionLocations,
                        id: testCase.id,
                        suitePath: testCase.suitePath
                    };
                });
                const testCaseShape = plainDataShape(comparableTestCases);

                scope.assert.deepEqual(
                    testCaseShape,
                    [
                        {
                            annotations: { ownership: [], tags: [ 'inherited', 'local' ] },
                            controls: { capture: null, timeoutMilliseconds: null },
                            definitionLocations: [ sourceLocationShape({}) ],
                            id: { file: null, title: 'first', params: null, suite: [] },
                            suitePath: []
                        },
                        {
                            annotations: { ownership: [], tags: [ 'inherited', 'table' ] },
                            controls: { capture: null, timeoutMilliseconds: null },
                            definitionLocations: [ sourceLocationShape({}) ],
                            id: {
                                file: null,
                                title: 'row 1',
                                params: parameterIdentity({ value: 1 }),
                                suite: [ 'rows' ]
                            },
                            suitePath: [
                                { definitionLocations: [ sourceLocationShape({}) ], title: 'rows' }
                            ]
                        },
                        {
                            annotations: { ownership: [], tags: [ 'inherited', 'table' ] },
                            controls: { capture: null, timeoutMilliseconds: null },
                            definitionLocations: [ sourceLocationShape({}) ],
                            id: {
                                file: null,
                                title: 'row 2',
                                params: parameterIdentity({ value: 2 }),
                                suite: [ 'rows' ]
                            },
                            suitePath: [
                                { definitionLocations: [ sourceLocationShape({}) ], title: 'rows' }
                            ]
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlanFromTestFiles() assigns file identity and resolves test data without file nesting',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const usersSuite = engine.createSuite({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    children: [
                        engine.createTestCase({
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            body(testScope) {
                                testScope.assert.true(true);
                                return testScope.assert.collect();
                            },
                            annotations: { ownership: [ 'case-team' ], tags: [ 'case' ] },
                            controls: { timeoutMilliseconds: 20 },
                            title: 'login'
                        })
                    ],
                    annotations: { ownership: [ 'suite-team' ], tags: [ 'suite' ] },
                    controls: { capture: 'live', timeoutMilliseconds: 15 },
                    title: 'users'
                });
                const testPlan = engine.createTestPlanFromTestFiles({
                    files: [
                        {
                            file: 'source/users.test.ts',
                            testNode: usersSuite
                        }
                    ],
                    root: {
                        annotations: { ownership: [ 'root-team' ], tags: [ 'root' ] },
                        controls: { capture: 'buffered', timeoutMilliseconds: 5 },
                        title: 'root'
                    }
                });
                const [ testCase ] = testPlan.cases;
                scope.require.defined(testCase);

                scope.assert.deepEqual(
                    plainDataShape({
                        annotations: testCase.annotations,
                        controls: testCase.controls,
                        id: testCase.id,
                        suitePath: testCase.suitePath
                    }),
                    {
                        annotations: {
                            ownership: [ 'root-team', 'suite-team', 'case-team' ],
                            tags: [ 'root', 'suite', 'case' ]
                        },
                        controls: { capture: 'live', timeoutMilliseconds: 20 },
                        id: { file: 'source/users.test.ts', title: 'login', params: null, suite: [ 'users' ] },
                        suitePath: [
                            { definitionLocations: [ { kind: 'unknown' as const } ], title: 'users' }
                        ]
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlanFromTestFiles() rejects file metadata fields',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const caseNode = engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'passes'
                });
                const fileInput = {
                    file: 'source/users.test.ts',
                    metadata: {},
                    testNode: caseNode
                } as unknown as TestPlanFromTestFilesOptions['files'][number];

                scope.assert.throws(function createPlanWithFileMetadata() {
                    engine.createTestPlanFromTestFiles({
                        files: [ fileInput ],
                        root: {
                            annotations: {},
                            controls: {},
                            title: 'root'
                        }
                    });
                }, { message: 'Unknown test file field: metadata.' });
                scope.assert.throws(function createPlanWithNonObjectFileInput() {
                    engine.createTestPlanFromTestFiles({
                        files: [ null as unknown as TestPlanFromTestFilesOptions['files'][number] ],
                        root: {
                            annotations: {},
                            controls: {},
                            title: 'root'
                        }
                    });
                }, { message: 'Test file input must be an object.' });
                scope.assert.throws(function createPlanWithEmptyFileIdentity() {
                    engine.createTestPlanFromTestFiles({
                        files: [ { file: '', testNode: caseNode } ],
                        root: {
                            annotations: {},
                            controls: {},
                            title: 'root'
                        }
                    });
                }, { message: 'Test file identity must not be empty.' });
                scope.assert.throws(function createPlanWithForeignFileTestNode() {
                    const foreignEngine = createEngine();
                    const foreignTestNode = foreignEngine.createTestCase({
                        annotations: {},
                        controls: {},
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body(testScope) {
                            testScope.assert.true(true);
                            return testScope.assert.collect();
                        },
                        title: 'foreign'
                    });

                    engine.createTestPlanFromTestFiles({
                        files: [ {
                            file: 'source/users.test.ts',
                            testNode: foreignTestNode
                        } ],
                        root: {
                            annotations: {},
                            controls: {},
                            title: 'root'
                        }
                    });
                }, { message: 'Test file must provide a TestNode created by the selected engine.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() rejects invalid test data field values',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const invalidTestDataCases = [
                    {
                        controls: {},
                        annotations: { tags: 'fast' },
                        message: 'Annotation field "tags" must be an array.'
                    },
                    {
                        controls: {},
                        annotations: { tags: [ '' ] },
                        message: 'Annotation field "tags" must contain non-empty strings.'
                    },
                    {
                        controls: { capture: 'raw' },
                        annotations: {},
                        message: 'Control field "capture" contains an unknown value.'
                    },
                    {
                        controls: { timeoutMilliseconds: Number.POSITIVE_INFINITY },
                        annotations: {},
                        message: 'Control field "timeoutMilliseconds" must be a finite number.'
                    }
                ];

                for (const invalidTestData of invalidTestDataCases) {
                    scope.assert.throws(function createCaseWithInvalidTestData() {
                        engine.createTestCase({
                            annotations: invalidTestData.annotations as never,
                            controls: invalidTestData.controls as never,
                            definitionLocations: [ { kind: 'unknown' as const } ],
                            body(testScope) {
                                testScope.assert.true(true);
                                return testScope.assert.collect();
                            },
                            title: 'invalid'
                        });
                    }, { message: invalidTestData.message });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() rejects unknown test data fields',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const invalidOptions: TestCaseOptions = {
                    body(testScope) {
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    },
                    annotations: Object.fromEntries([ [ 'tag', 'fast' ] ]),
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    title: 'invalid'
                };

                scope.assert.throws(function createTestCaseWithUnknownTestData() {
                    engine.createTestCase(invalidOptions);
                }, { message: 'Unknown annotation field: tag.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects reachable empty suites',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });

                scope.assert.throws(function createPlanWithEmptySuite() {
                    engine.createTestPlan(root);
                }, { message: 'Root must contain at least one child: root.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects reachable empty nested suites',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
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
            title: 'createTestPlan() rejects non-root test nodes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'passes'
                });

                scope.assert.throws(function createPlanFromTestCase() {
                    engine.createTestPlan(testCase as never);
                }, { message: 'Test plan root must be an engine-created TestRoot value.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestPlan() rejects roots from another engine instance',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const root = firstEngine.createRoot({
                    children: [],
                    annotations: {},
                    controls: {},
                    title: 'root'
                });

                scope.assert.throws(function createForeignPlan() {
                    secondEngine.createTestPlan(root);
                }, { message: 'Test plan root must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
