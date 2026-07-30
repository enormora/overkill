import assert from 'node:assert/strict';
import type { FailedCompositeCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { BodyErrorTestFailure, FailOutcome, RunResult } from './run-result.ts';
import type { TestBody, TestContext } from './test-node.ts';

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

function firstFailOutcome(result: RunResult): FailOutcome {
    const firstResult = result.perTest.at(0);

    assert.notEqual(firstResult, undefined);

    if (firstResult?.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    throw new TypeError('Expected first outcome to fail.');
}

function firstCompositeCheck(outcome: FailOutcome): FailedCompositeCheck {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        const check = failure.checks[0];

        if (check.kind === 'composite') {
            return check;
        }
    }

    throw new TypeError('Expected composite failed check.');
}

function firstBodyError(outcome: FailOutcome): BodyErrorTestFailure {
    const failure = outcome.failures[0];

    if (failure.kind === 'body-error') {
        return failure;
    }

    throw new TypeError('Expected body error failure.');
}

registerTest('execute() counts throws and awaited rejects as assertion boundaries', async function () {
    const result = await executeSingleBody(async function body(testContext: TestContext) {
        testContext.plan(2);
        testContext.assert.throws(function throwExpectedError() {
            throw new Error('expected');
        }, { message: 'expected' });
        await testContext.assert.rejects(async function rejectExpectedError() {
            await Promise.reject(new Error('expected'));
        }, { message: 'expected' });

        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
});

registerTest('execute() rejects unawaited async rejects assertions at done', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        const pendingAssertions = [
            testContext.assert.rejects(async function rejectExpectedError() {
                await Promise.reject(new Error('expected'));
            }, { message: 'expected' })
        ];

        assert.equal(pendingAssertions.length, 1);
        return testContext.assert.done();
    });

    assert.deepStrictEqual(firstFailOutcome(result).failures, [
        {
            actual: 'pending async assertion',
            code: 'pending-async-assertion',
            expected: 'all async assertions awaited before done',
            kind: 'test-contract',
            summary: 'Async assertion must be awaited before case.assert.done().'
        }
    ]);
});

registerTest('execute() treats sync throws from rejects thunks as body errors', async function () {
    function throwBeforePromise(): never {
        throw new TypeError('sync boom');
    }

    const result = await executeSingleBody(async function body(testContext: TestContext) {
        await testContext.assert.rejects(throwBeforePromise, { message: 'sync boom' });

        return testContext.assert.done();
    });

    assert.equal(firstBodyError(firstFailOutcome(result)).error.message, 'sync boom');
});

registerTest('execute() reports throws matcher field failures under one composite boundary', async function () {
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert.throws(
            function throwWrongError() {
                throw new TypeError('actual');
            },
            { message: 'expected', type: RangeError },
            { message: 'throw contract' }
        );

        return testContext.assert.done();
    });
    const composite = firstCompositeCheck(firstFailOutcome(result));

    assert.equal(composite.summary, 'throw contract');
    assert.deepStrictEqual(
        composite.children.map(function summaryOf(child) {
            return child.summary;
        }),
        [
            'Expected thrown value to be an instance of the constructor.',
            'Expected thrown value message to equal the string.'
        ]
    );
});
