import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { isTestNode } from './test-node.ts';

export const testSuite = createOverkillSuite({
    name: 'source/engine/test-node.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'createTestCase() creates a branded test node',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();
                const testCase = engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: { priority: 'critical' },
                    name: 'passes'
                });

                scope.assert.equal(isTestNode(testCase), true);
                scope.assert.equal(testCase.kind, 'test');
                scope.assert.equal(testCase.name, 'passes');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTestCase() rejects an empty name',
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
                        name: ' '
                    });
                }, { message: 'Test node name must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createSuite() rejects non-object metadata',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidSuite() {
                    engine.createSuite({
                        children: [],
                        metadata: null as never,
                        name: 'suite'
                    });
                }, { message: 'Test node metadata must be an object.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createSuite() rejects plain object test nodes',
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
                        name: 'suite'
                    });
                }, { message: 'Suite children must be engine-created TestNode values.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createSuite() rejects nodes from another engine instance',
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
                    name: 'foreign'
                });

                scope.assert.throws(function createInvalidSuite() {
                    secondEngine.createSuite({
                        children: [ foreignTest ],
                        metadata: {},
                        name: 'suite'
                    });
                }, { message: 'Suite children must be created by the same engine instance.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createTable() validates case bodies',
            metadata: {},
            body(scope: OverkillScope) {
                const engine = createEngine();

                scope.assert.throws(function createInvalidTable() {
                    engine.createTable({
                        cases: [
                            {
                                body: 'not-callable' as never,
                                metadata: {},
                                name: 'row',
                                parameters: {}
                            }
                        ],
                        metadata: {},
                        name: 'table'
                    });
                }, { message: 'Test case body must be a function.' });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
