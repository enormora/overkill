import assert from 'node:assert/strict';
import { createInMemoryFinalResultReporter, createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
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

registerTest('execute() delivers events and final results to reporters', async function () {
    const realTimeReporter = createInMemoryRealTimeReporter();
    const finalResultReporter = createInMemoryFinalResultReporter();
    const testPlan = createTestPlan(
        createSuite({
            children: [
                createTestCase({
                    body(testContext) {
                        return testContext.assert.ok(true, 'passes');
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );

    const result = await execute(testPlan, {
        reporters: [ realTimeReporter, finalResultReporter ],
        runFacts: { seed: 42 },
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.deepStrictEqual(
        realTimeReporter.getRecordedEntries().map(function toType(entry) {
            return entry.type;
        }),
        [ 'event', 'event', 'event', 'event', 'finish' ]
    );
    assert.deepStrictEqual(
        finalResultReporter.getRecordedEntries(),
        [ { event: null, result, type: 'result' } ]
    );
});
