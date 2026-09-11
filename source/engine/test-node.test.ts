import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { isTestNode, isTestRoot, stampTestNodeFamily } from './test-node.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/test-node.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() creates a branded test root',
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
                const root = engine.createRoot({
                    annotations: {},
                    children: [ testCase ],
                    controls: {},
                    title: 'root'
                });

                scope.assert.equal(isTestRoot(root), true);
                scope.assert.equal(isTestNode(root), false);
                scope.assert.equal(root.kind, 'root');
                scope.assert.equal(root.title, 'root');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects an empty title',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createUnnamedRoot() {
                    engine.createRoot({
                        children: [],
                        annotations: {},
                        controls: {},
                        title: ' '
                    });
                }, { message: 'Test node title must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects non-object annotations',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidRoot() {
                    engine.createRoot({
                        annotations: null as never,
                        children: [],
                        controls: {},
                        title: 'root'
                    });
                }, { message: 'Test node annotations must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects plain object test nodes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidRoot() {
                    engine.createRoot({
                        children: [
                            {
                                kind: 'test',
                                annotations: {},
                                controls: {},
                                title: 'plain'
                            }
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    });
                }, { message: 'Root children must be engine-created TestNode values.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects nodes from another engine instance',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'foreign'
                });

                scope.assert.throws(function createInvalidRoot() {
                    secondEngine.createRoot({
                        children: [ foreignTest ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    });
                }, { message: 'Root children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() creates a branded test node',
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
                    controls: { timeoutMilliseconds: 50 },
                    title: 'passes'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.equal(testCase.execution.kind, 'body');
                if (testCase.execution.kind === 'body') {
                    scope.assert.equal(testCase.execution.bodyMode, 'builder');
                }
                scope.assert.equal(testCase.title, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createThrowingTestCase() creates a branded test node',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createThrowingTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                    },
                    annotations: {},
                    controls: { timeoutMilliseconds: 50 },
                    title: 'passes'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.equal(testCase.execution.kind, 'body');
                if (testCase.execution.kind === 'body') {
                    scope.assert.equal(testCase.execution.bodyMode, 'throwing');
                }
                scope.assert.equal(testCase.title, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSkippedTestCase() creates a branded test node',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createSkippedTestCase({
                    annotations: { tags: [ 'critical' ] },
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    reason: ' not available ',
                    title: 'skips'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.deepEqual(testCase.execution, { kind: 'skip', reason: 'not available' });
                scope.assert.equal(testCase.title, 'skips');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() rejects an empty title',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createUnnamedTestCase() {
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body(testScope) {
                            testScope.assert.true(true, { message: 'passes' });
                            return testScope.assert.collect();
                        },
                        annotations: {},
                        controls: {},
                        title: ' '
                    });
                }, { message: 'Test node title must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSkippedTestCase() rejects invalid reason values',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createSkippedTestCaseWithNonStringReason() {
                    engine.createSkippedTestCase({
                        annotations: {},
                        controls: {},
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        reason: 1 as never,
                        title: 'skips'
                    });
                }, { message: 'Skipped test reason must be a string.' });
                scope.assert.throws(function createSkippedTestCaseWithEmptyReason() {
                    engine.createSkippedTestCase({
                        annotations: {},
                        controls: {},
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        reason: ' ',
                        title: 'skips'
                    });
                }, { message: 'Skipped test reason must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() rejects invalid title and definition location values',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const validBody = function body(
                    testScope: OverkillScope
                ): ReturnType<OverkillScope['assert']['collect']> {
                    testScope.assert.true(true, { message: 'passes' });
                    return testScope.assert.collect();
                };

                scope.assert.throws(function createTestCaseWithNonStringTitle() {
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body: validBody,
                        annotations: {},
                        controls: {},
                        title: 1 as never
                    });
                }, { message: 'Test node title must be a string.' });
                scope.assert.throws(function createTestCaseWithoutDefinitionLocations() {
                    engine.createTestCase({
                        definitionLocations: [] as never,
                        body: validBody,
                        annotations: {},
                        controls: {},
                        title: 'missing location'
                    });
                }, { message: 'Test node definition locations must contain at least one location.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects non-object test data',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        annotations: null as never,
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [],
                        controls: {},
                        title: 'suite'
                    });
                }, { message: 'Test node annotations must be an object.' });
                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        annotations: {},
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [],
                        controls: null as never,
                        title: 'suite'
                    });
                }, { message: 'Test node controls must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'stampTestNodeFamily() rejects conflicting families',
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

                stampTestNodeFamily(testCase, 'microtest');
                scope.assert.throws(function stampConflictingFamily() {
                    stampTestNodeFamily(testCase, 'integration');
                }, { message: 'Test node already belongs to test family "microtest".' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects plain object test nodes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [
                            {
                                kind: 'test',
                                annotations: {},
                                controls: {},
                                name: 'plain'
                            }
                        ],
                        annotations: {},
                        controls: {},
                        title: 'suite'
                    });
                }, { message: 'Suite children must be engine-created TestNode values.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects nodes from another engine instance',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'foreign'
                });

                scope.assert.throws(function createInvalidSuite() {
                    secondEngine.createSuite({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [ foreignTest ],
                        annotations: {},
                        controls: {},
                        title: 'suite'
                    });
                }, { message: 'Suite children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTable() validates case bodies',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidTable() {
                    engine.createTable({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        cases: [
                            {
                                body: 'not-callable' as never,
                                annotations: {},
                                controls: {},
                                title: 'row',
                                parameters: {}
                            }
                        ],
                        annotations: {},
                        controls: {},
                        title: 'table'
                    });
                }, { message: 'Test case body must be a function.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
