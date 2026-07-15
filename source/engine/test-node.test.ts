import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { createSuite, createTable, createTestCase, isTestNode } from './test-node.ts';

registerTest('createTestCase() creates a branded test node', function () {
    const testCase = createTestCase({
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
    assert.throws(
        function createUnnamedTestCase() {
            createTestCase({
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
    assert.throws(
        function createInvalidSuite() {
            createSuite({
                children: [],
                metadata: null as never,
                name: 'suite'
            });
        },
        { message: 'Test node metadata must be an object.' }
    );
});

registerTest('createSuite() rejects plain object test nodes', function () {
    assert.throws(
        function createInvalidSuite() {
            createSuite({
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

registerTest('createTable() validates case bodies', function () {
    assert.throws(
        function createInvalidTable() {
            createTable({
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
