import assert from 'node:assert/strict';
import type { AssertAssertionNode } from '../assertion-protocol/assertions.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { FailOutcome, RunResult } from './run-result.ts';
import type { TestBody, TestContext } from './test-node.ts';

function firstFailOutcome(result: RunResult): FailOutcome {
    const firstResult = result.perTest.at(0);

    assert.notEqual(firstResult, undefined);

    if (firstResult === undefined) {
        throw new TypeError('Expected at least one test result.');
    }

    if (firstResult.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    throw new TypeError('Expected first outcome to fail.');
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createSuite({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        name: 'case'
                    })
                ],
                metadata: {},
                name: 'root'
            })
        )
    );
}

registerTest('execute() counts successful requirements once a returned assertion result exists', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.plan(2);
        testContext.require.string('value');
        testContext.assert.true(true);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() rejects successful require-only builder completion', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.require.string('value');
        return testContext.assert.done();
    });

    assert.deepStrictEqual(firstFailOutcome(result).failures, [
        {
            actual: 0,
            code: 'no-assertions',
            expected: 'at least one assertion',
            kind: 'test-contract',
            summary: 'Expected at least one assertion.'
        }
    ]);
});

registerTest('execute() skips plan mismatch when a requirement fails', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.plan(2);
        testContext.require.string(1, { message: 'required string' });
        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(outcome.failures, [
        {
            checks: [
                {
                    actual: 1,
                    expected: 'string',
                    id: '1',
                    location: { column: null, file: '', line: null },
                    path: [],
                    source: 'require',
                    summary: 'required string'
                }
            ],
            kind: 'assertion'
        }
    ]);
});

registerTest('execute() treats caught failed requirements as fatal and ignores later assertions', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        try {
            testContext.require.string(1, { message: 'required string' });
        } catch {
            testContext.assert.fail({ message: 'ignored failure' });
        }

        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(outcome.failures, [
        {
            checks: [
                {
                    actual: 1,
                    expected: 'string',
                    id: '1',
                    location: { column: null, file: '', line: null },
                    path: [],
                    source: 'require',
                    summary: 'required string'
                }
            ],
            kind: 'assertion'
        }
    ]);
});

registerTest('execute() rejects returned results that drop recorded builder assertions', async function () {
    const result = await executeSingleBody(function body(testContext) {
        const replacement: AssertAssertionNode = {
            actual: true,
            check: 'true',
            message: null,
            source: 'assert'
        };

        testContext.assert.true(true);

        return [ replacement ];
    });

    assert.deepStrictEqual(firstFailOutcome(result).failures, [
        {
            actual: 'missing recorded builder assertion',
            code: 'dead-builder-assertion',
            expected: 'returned assertions include every recorded builder assertion',
            kind: 'test-contract',
            summary: 'Returned assertions must include every recorded builder assertion.'
        }
    ]);
});

registerTest('execute() accepts appended direct assertions around builder assertions', async function () {
    const result = await executeSingleBody(function body(testContext) {
        const leading: AssertAssertionNode = {
            actual: true,
            check: 'true',
            message: null,
            source: 'assert'
        };
        const trailing: AssertAssertionNode = {
            actual: false,
            check: 'false',
            message: null,
            source: 'assert'
        };

        testContext.plan(3);
        testContext.assert.true(true);

        return [ leading, ...testContext.assert.done(), trailing ];
    });

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() merges successful requirements by timeline for counts and check ids', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.plan(3);
        testContext.assert.equal(1, 2, { message: 'first assert' });
        testContext.require.string('value');
        testContext.assert.equal(3, 4, { message: 'second assert' });
        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(
        outcome.failures.flatMap(function failedChecks(failure) {
            return failure.kind === 'assertion'
                ? failure.checks.map(function toCheck(check) {
                    return { id: check.id, summary: check.summary };
                })
                : [];
        }),
        [
            { id: '1', summary: 'first assert' },
            { id: '3', summary: 'second assert' }
        ]
    );
});
