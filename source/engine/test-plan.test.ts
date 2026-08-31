import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { TestCaseOptions } from './test-node.ts';

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

function metadataShape(fields: Readonly<Record<string, unknown>>): unknown {
    return {
        baselines: [],
        capabilities: [],
        capture: null,
        debug: false,
        extra: {},
        kind: null,
        ownership: [],
        priority: 'standard',
        runtimes: [],
        stability: 'stable',
        tags: [],
        timeoutMilliseconds: null,
        ...fields
    };
}

function sourceLocationShape(fields: Readonly<Record<string, unknown>>): unknown {
    return {
        column: null,
        file: '',
        line: null,
        ...fields
    };
}

function parameterIdentity(parameters: Readonly<Record<string, unknown>>): string {
    return JSON.stringify(serializeValue(parameters));
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
                            metadata: { tags: [ 'local' ] },
                            name: 'first'
                        }),
                        engine.createTable({
                            cases: [
                                {
                                    body(testScope) {
                                        testScope.assert.true(true, { message: 'row passes' });
                                        return testScope.assert.collect();
                                    },
                                    metadata: { extra: { row: 1 } },
                                    name: 'row 1',
                                    parameters: { value: 1 }
                                }
                            ],
                            metadata: { tags: [ 'table' ] },
                            name: 'rows'
                        })
                    ],
                    metadata: { tags: [ 'inherited' ] },
                    name: 'root'
                });

                const testPlan = engine.createTestPlan(root);

                const comparableTestCases = testPlan.cases.map(function toComparableTestCase(testCase) {
                    return {
                        definitionLocation: testCase.definitionLocation,
                        id: testCase.id,
                        metadata: testCase.metadata,
                        suiteDefinitionLocations: testCase.suiteDefinitionLocations,
                        suitePath: testCase.suitePath
                    };
                });
                const testCaseShape = plainDataShape(comparableTestCases);

                scope.assert.deepEqual(
                    testCaseShape,
                    [
                        {
                            definitionLocation: sourceLocationShape({}),
                            id: { file: null, name: 'first', params: null, suite: [] },
                            metadata: metadataShape({ tags: [ 'inherited', 'local' ] }),
                            suiteDefinitionLocations: [],
                            suitePath: []
                        },
                        {
                            definitionLocation: sourceLocationShape({}),
                            id: {
                                file: null,
                                name: 'row 1',
                                params: parameterIdentity({ value: 1 }),
                                suite: [ 'rows' ]
                            },
                            metadata: metadataShape({ extra: { row: 1 }, tags: [ 'inherited', 'table' ] }),
                            suiteDefinitionLocations: [ sourceLocationShape({}) ],
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
            name: 'createTestPlanFromTestFiles() resolves structured metadata without file suite nesting',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testNode = engine.createSuite({
                    children: [
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true);
                                return testScope.assert.collect();
                            },
                            metadata: {
                                debug: false,
                                extra: { case: true },
                                ownership: [ 'case-team' ],
                                tags: [ 'case' ],
                                timeoutMilliseconds: 20
                            },
                            name: 'login'
                        })
                    ],
                    metadata: {
                        baselines: [ 'terminal-snapshot' ],
                        capabilities: [ 'fs-read' ],
                        capture: 'live',
                        debug: true,
                        extra: { suite: true },
                        kind: 'integration',
                        priority: 'standard',
                        runtimes: { mode: 'replace', values: [ 'node' ] },
                        stability: 'stable',
                        tags: [ 'suite' ],
                        timeoutMilliseconds: 15
                    },
                    name: 'users'
                });
                const testPlan = engine.createTestPlanFromTestFiles({
                    files: [
                        {
                            file: 'source/users.test.ts',
                            metadata: {
                                baselines: [ 'visual-snapshot' ],
                                capabilities: [ 'fs-read' ],
                                capture: 'buffered',
                                debug: false,
                                extra: { file: true, root: false },
                                ownership: [ 'file-team' ],
                                priority: 'optional',
                                runtimes: { mode: 'append', values: [ 'browser' ] },
                                stability: 'experimental',
                                tags: [ 'file' ],
                                timeoutMilliseconds: 10
                            },
                            testNode
                        }
                    ],
                    root: {
                        metadata: {
                            baselines: [ 'content-snapshot' ],
                            capabilities: [ 'fs-read', 'net' ],
                            capture: 'live',
                            debug: true,
                            extra: { root: true },
                            kind: 'microtest',
                            ownership: [ 'root-team' ],
                            priority: 'critical',
                            runtimes: [ 'node' ],
                            stability: 'flaky',
                            tags: [ 'root' ],
                            timeoutMilliseconds: 5
                        },
                        name: 'root'
                    }
                });
                const [ testCase ] = testPlan.cases;
                scope.require.defined(testCase);

                scope.assert.deepEqual(
                    plainDataShape({
                        id: testCase.id,
                        metadata: testCase.metadata,
                        suitePath: testCase.suitePath
                    }),
                    {
                        id: { file: 'source/users.test.ts', name: 'login', params: null, suite: [ 'users' ] },
                        metadata: {
                            baselines: [ 'content-snapshot', 'visual-snapshot', 'terminal-snapshot' ],
                            capabilities: [ 'fs-read' ],
                            capture: 'live',
                            debug: false,
                            extra: { case: true, file: true, root: false, suite: true },
                            kind: 'integration',
                            ownership: [ 'root-team', 'file-team', 'case-team' ],
                            priority: 'standard',
                            runtimes: [ 'node' ],
                            stability: 'stable',
                            tags: [ 'root', 'file', 'suite', 'case' ],
                            timeoutMilliseconds: 20
                        },
                        suitePath: [ 'users' ]
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestPlan() rejects metadata that widens parent capabilities',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const root = engine.createRoot({
                    children: [
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true);
                                return testScope.assert.collect();
                            },
                            metadata: { capabilities: [ 'net' ] },
                            name: 'widens'
                        })
                    ],
                    metadata: { capabilities: [ 'fs-read' ] },
                    name: 'root'
                });

                scope.assert.throws(function createPlanWithWidenedCapabilities() {
                    engine.createTestPlan(root);
                }, { message: 'Metadata capabilities cannot widen parent capability: net.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestCase() rejects invalid metadata field values',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const invalidMetadataCases = [
                    { field: 'tags', message: 'Metadata field "tags" must be an array.', value: 'fast' },
                    { field: 'tags', message: 'Metadata field "tags" must contain non-empty strings.', value: [ '' ] },
                    { field: 'kind', message: 'Metadata field "kind" contains an unknown value.', value: 'unit' },
                    { field: 'capabilities', message: 'Metadata field "capabilities" must be an array.', value: 'net' },
                    { field: 'extra', message: 'Metadata field "extra" must be an object.', value: [] },
                    { field: 'debug', message: 'Metadata field "debug" must be a boolean.', value: 'true' },
                    {
                        field: 'timeoutMilliseconds',
                        message: 'Metadata field "timeoutMilliseconds" must be a finite number.',
                        value: Number.POSITIVE_INFINITY
                    },
                    {
                        field: 'runtimes',
                        message: 'Metadata field "runtimes" must be an array or runtime metadata object.',
                        value: 'node'
                    },
                    {
                        field: 'runtimes',
                        message: 'Unknown runtime metadata field: source.',
                        value: { mode: 'append', source: 'local', values: [] }
                    }
                ];

                for (const invalidMetadata of invalidMetadataCases) {
                    scope.assert.throws(function createCaseWithInvalidMetadata() {
                        engine.createTestCase({
                            body(testScope) {
                                testScope.assert.true(true);
                                return testScope.assert.collect();
                            },
                            metadata: Object.fromEntries([ [ invalidMetadata.field, invalidMetadata.value ] ]),
                            name: 'invalid'
                        });
                    }, { message: invalidMetadata.message });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestCase() rejects unknown metadata fields',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const invalidOptions: TestCaseOptions = {
                    body(testScope) {
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    },
                    metadata: Object.fromEntries([ [ 'tag', 'fast' ] ]),
                    name: 'invalid'
                };

                scope.assert.throws(function createTestCaseWithUnknownMetadata() {
                    engine.createTestCase(invalidOptions);
                }, { message: 'Unknown metadata field: tag.' });

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
