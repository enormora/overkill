import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { isTestNode } from './test-node.ts';

registerTest('createTestCase() creates a branded test node', function () {
    const engine = createEngine();
    const testCase = engine.createTestCase({
        body(testContext) {
            return testContext.assert.ok(true, 'passes');
        },
        metadata: { priority: 'critical' },
        name: 'passes'
    });

    assert.equal(isTestNode(testCase), true);
    assert.equal(testCase.kind, 'test');
    assert.equal(testCase.name, 'passes');
});

registerTest('createTestCase() rejects an empty name', function () {
    const engine = createEngine();

    assert.throws(
        function createUnnamedTestCase() {
            engine.createTestCase({
                body(testContext) {
                    return testContext.assert.ok(true, 'passes');
                },
                metadata: {},
                name: ' '
            });
        },
        { message: 'Test node name must not be empty.' }
    );
});

registerTest('createSuite() rejects non-object metadata', function () {
    const engine = createEngine();

    assert.throws(
        function createInvalidSuite() {
            engine.createSuite({
                children: [],
                metadata: null as never,
                name: 'suite'
            });
        },
        { message: 'Test node metadata must be an object.' }
    );
});

registerTest('createSuite() rejects plain object test nodes', function () {
    const engine = createEngine();

    assert.throws(
        function createInvalidSuite() {
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
        },
        { message: 'Suite children must be engine-created TestNode values.' }
    );
});

registerTest('createSuite() rejects nodes from another engine instance', function () {
    const firstEngine = createEngine();
    const secondEngine = createEngine();
    const foreignTest = firstEngine.createTestCase({
        body(testContext) {
            return testContext.assert.ok(true, 'passes');
        },
        metadata: {},
        name: 'foreign'
    });

    assert.throws(
        function createInvalidSuite() {
            secondEngine.createSuite({
                children: [ foreignTest ],
                metadata: {},
                name: 'suite'
            });
        },
        { message: 'Suite children must be created by the same engine instance.' }
    );
});

registerTest('createTable() validates case bodies', function () {
    const engine = createEngine();

    assert.throws(
        function createInvalidTable() {
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
        },
        { message: 'Test case body must be a function.' }
    );
});
