import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { execute } from './execution.ts';
import { createTestPlan } from './test-plan.ts';
import { createSuite, createTestCase } from './test-node.ts';

registerTest('execute() returns passing and failing outcomes with run counts', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body(testContext) {
                        return testContext.assert.ok(true, 'passes');
                    },
                    metadata: {},
                    name: 'passes'
                }),
                createTestCase({
                    body(testContext) {
                        return testContext.assert.equal(1, 2, 'numbers differ');
                    },
                    metadata: {},
                    name: 'fails'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.defined, 2);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.bySuite.root, { discovered: 2, executed: 2 });
    assert.deepStrictEqual(
        result.perTest.map(function toVerdict(testResult) {
            return testResult.verdict;
        }),
        [ 'pass', 'fail' ]
    );
});

registerTest('execute() fails tests with zero assertions', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body() {
                        return undefined;
                    },
                    metadata: {},
                    name: 'empty'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.perTest[0]?.outcome, {
        checks: [
            {
                actual: 0,
                expected: 'at least one assertion',
                id: '1',
                location: { column: null, file: '', line: null },
                path: [],
                summary: 'Expected at least one assertion.'
            }
        ],
        kind: 'fail',
        reason: null
    });
});

registerTest('execute() fails tests when assertion plan count does not match', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body(testContext) {
                        testContext.plan(2);
                        return testContext.assert.ok(true, 'one');
                    },
                    metadata: {},
                    name: 'planned'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.perTest[0]?.outcome, {
        checks: [
            {
                actual: 1,
                expected: 2,
                id: '1',
                location: { column: null, file: '', line: null },
                path: [],
                summary: 'Assertion plan count did not match.'
            }
        ],
        kind: 'fail',
        reason: null
    });
});
registerTest('execute() exposes assertion and requirement convenience methods', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body(testContext) {
                        testContext.assert.done();
                        testContext.require.done();
                        testContext.require.equal(1, 1, 'equal');
                        testContext.require.ok(true, 'ok');

                        return testContext.assert.ok(true, 'passes');
                    },
                    metadata: {},
                    name: 'uses context'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() fails the test when a requirement fails', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body(testContext) {
                        return testContext.require.equal(1, 2, 'required equality');
                    },
                    metadata: {},
                    name: 'requires equality'
                }),
                createTestCase({
                    body(testContext) {
                        return testContext.require.ok(false, 'required truth');
                    },
                    metadata: {},
                    name: 'requires truth'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.failed, 2);
    assert.deepStrictEqual(
        result.perTest.map(function toSummary(testResult) {
            return testResult.outcome.checks[0]?.summary;
        }),
        [ 'required equality', 'required truth' ]
    );
});

registerTest('execute() records thrown test body errors', async function () {
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body() {
                        throw new Error('boom');
                    },
                    metadata: {},
                    name: 'throws error'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan);

    assert.equal(result.summary.failed, 1);
    assert.equal(result.perTest[0]?.outcome.checks[0]?.summary, 'boom');
});
