import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { isTestNode, isTestRoot } from './test-node.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/test-node.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() creates a branded test root',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    title: 'passes'
                });
                const root = engine.createRoot({
                    children: [ testCase ],
                    metadata: { priority: 'critical' },
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
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createUnnamedRoot() {
                    engine.createRoot({
                        children: [],
                        metadata: {},
                        title: ' '
                    });
                }, { message: 'Test node title must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects non-object metadata',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidRoot() {
                    engine.createRoot({
                        children: [],
                        metadata: null as never,
                        title: 'root'
                    });
                }, { message: 'Test node metadata must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects plain object test nodes',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidRoot() {
                    engine.createRoot({
                        children: [
                            {
                                kind: 'test',
                                metadata: {},
                                title: 'plain'
                            }
                        ],
                        metadata: {},
                        title: 'root'
                    });
                }, { message: 'Root children must be engine-created TestNode values.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createRoot() rejects nodes from another engine instance',
            metadata: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    title: 'foreign'
                });

                scope.assert.throws(function createInvalidRoot() {
                    secondEngine.createRoot({
                        children: [ foreignTest ],
                        metadata: {},
                        title: 'root'
                    });
                }, { message: 'Root children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTestCase() creates a branded test node',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: { priority: 'critical' },
                    title: 'passes'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.equal(testCase.execution.kind, 'body');
                scope.assert.equal(testCase.title, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSkippedTestCase() creates a branded test node',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createSkippedTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    metadata: { priority: 'critical' },
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
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createUnnamedTestCase() {
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body(testScope) {
                            testScope.assert.true(true, { message: 'passes' });
                            return testScope.assert.collect();
                        },
                        metadata: {},
                        title: ' '
                    });
                }, { message: 'Test node title must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSkippedTestCase() rejects invalid reason values',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createSkippedTestCaseWithNonStringReason() {
                    engine.createSkippedTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        metadata: {},
                        reason: 1 as never,
                        title: 'skips'
                    });
                }, { message: 'Skipped test reason must be a string.' });
                scope.assert.throws(function createSkippedTestCaseWithEmptyReason() {
                    engine.createSkippedTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        metadata: {},
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
            metadata: {},
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
                        metadata: {},
                        title: 1 as never
                    });
                }, { message: 'Test node title must be a string.' });
                scope.assert.throws(function createTestCaseWithoutDefinitionLocations() {
                    engine.createTestCase({
                        definitionLocations: [] as never,
                        body: validBody,
                        metadata: {},
                        title: 'missing location'
                    });
                }, { message: 'Test node definition locations must contain at least one location.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects non-object metadata',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [],
                        metadata: null as never,
                        title: 'suite'
                    });
                }, { message: 'Test node metadata must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects plain object test nodes',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [
                            {
                                kind: 'test',
                                metadata: {},
                                name: 'plain'
                            }
                        ],
                        metadata: {},
                        title: 'suite'
                    });
                }, { message: 'Suite children must be engine-created TestNode values.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createSuite() rejects nodes from another engine instance',
            metadata: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    title: 'foreign'
                });

                scope.assert.throws(function createInvalidSuite() {
                    secondEngine.createSuite({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        children: [ foreignTest ],
                        metadata: {},
                        title: 'suite'
                    });
                }, { message: 'Suite children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'createTable() validates case bodies',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidTable() {
                    engine.createTable({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        cases: [
                            {
                                body: 'not-callable' as never,
                                metadata: {},
                                title: 'row',
                                parameters: {}
                            }
                        ],
                        metadata: {},
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
