import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { isTestNode, isTestRoot } from './test-node.ts';

export const testSuite = createOverkillSuite({
    title: 'source/engine/test-node.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'createRoot() creates a branded test root',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
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
            title: 'createRoot() rejects nodes from another engine instance',
            metadata: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
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
            title: 'createTestCase() creates a branded test node',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: { priority: 'critical' },
                    title: 'passes'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.equal(testCase.title, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createTestCase() rejects an empty title',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createUnnamedTestCase() {
                    engine.createTestCase({
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
            title: 'createSuite() rejects non-object metadata',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        children: [],
                        metadata: null as never,
                        title: 'suite'
                    });
                }, { message: 'Test node metadata must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createSuite() rejects plain object test nodes',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
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
            title: 'createSuite() rejects nodes from another engine instance',
            metadata: {},
            body(scope: OverkillScope) {
                const firstEngine = createEngine();
                const secondEngine = createEngine();
                const foreignTest = firstEngine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    title: 'foreign'
                });

                scope.assert.throws(function createInvalidSuite() {
                    secondEngine.createSuite({
                        children: [ foreignTest ],
                        metadata: {},
                        title: 'suite'
                    });
                }, { message: 'Suite children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'createTable() validates case bodies',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidTable() {
                    engine.createTable({
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
