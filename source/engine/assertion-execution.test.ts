import assert from 'node:assert/strict';
import {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion
} from '../assertion-protocol/assertion-reference.ts';
import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
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
                    kind: 'leaf',
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
                    kind: 'leaf',
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

registerTest('execute() records callable composite assertion references as one planned boundary', async function () {
    const resultOk = defineCompositeAssertion({
        assert(check, result: { readonly ok: boolean; }) {
            return check.true(result.ok);
        },
        name: 'resultOk'
    });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.plan(1);
        testContext.assert(resultOk, { ok: true });
        testContext.assert.length([ 1, 2 ], 2);
        return testContext.assert.done();
    });

    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(firstFailOutcome(result).failures, [
        {
            actual: 2,
            code: 'plan-mismatch',
            expected: '1',
            kind: 'test-contract',
            summary: 'Assertion plan count did not match.'
        }
    ]);
});

registerTest('execute() reports composite parent failures with child diagnostics', async function () {
    const resultOk = defineCompositeAssertion({
        assert(check, result: { readonly ok: boolean; readonly value: unknown; }, expected: unknown) {
            return check.group([
                check.annotated('status').true(result.ok),
                check.annotated('value').deepEqual(result.value, expected)
            ]);
        },
        formatSummary(context, result, expected) {
            void result;
            void expected;
            return `Expected ${context.name} to match.`;
        },
        name: 'resultOk'
    });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert(resultOk, { ok: false, value: 1 }, 2);
        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(outcome.failures, [
        {
            checks: [
                {
                    actual: { ok: false, value: 1 },
                    children: [
                        {
                            actual: false,
                            expected: true,
                            id: '1.1',
                            kind: 'leaf',
                            location: { column: null, file: '', line: null },
                            path: [],
                            source: 'assert',
                            summary: 'status'
                        },
                        {
                            actual: 1,
                            expected: 2,
                            id: '1.2',
                            kind: 'leaf',
                            location: { column: null, file: '', line: null },
                            path: [],
                            source: 'assert',
                            summary: 'value'
                        }
                    ],
                    expected: 2,
                    id: '1',
                    kind: 'composite',
                    location: { column: null, file: '', line: null },
                    path: [],
                    source: 'assert',
                    summary: 'Expected resultOk to match.'
                }
            ],
            kind: 'assertion'
        }
    ]);
});

registerTest('execute() short-circuits failed narrowing assertion references through require', async function () {
    type Ok = { readonly ok: true; readonly value: string; };
    type Result = Ok | { readonly ok: false; readonly error: Error; };
    const resultOk = defineNarrowingCompositeAssertion({
        name: 'resultOk',
        narrows(result: Result): result is Ok {
            return result.ok;
        }
    });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.plan(2);
        const actual: Result = { error: new Error('boom'), ok: false };

        testContext.require(resultOk, actual);
        testContext.assert.fail({ message: 'ignored' });
        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);

    assert.deepStrictEqual(outcome.failures, [
        {
            checks: [
                {
                    actual: { error: actualError(outcome), ok: false },
                    children: [
                        {
                            actual: false,
                            expected: true,
                            id: '1.1',
                            kind: 'leaf',
                            location: { column: null, file: '', line: null },
                            path: [],
                            source: 'require',
                            summary: 'Expected resultOk narrowing predicate to pass.'
                        }
                    ],
                    expected: 'resultOk',
                    id: '1',
                    kind: 'composite',
                    location: { column: null, file: '', line: null },
                    path: [],
                    source: 'require',
                    summary: 'Expected resultOk assertion to pass.'
                }
            ],
            kind: 'assertion'
        }
    ]);
});

registerTest('execute() rejects unawaited async custom assertions at done', async function () {
    const eventuallyOk = defineCompositeAssertion({
        async assert(check) {
            await Promise.resolve();
            return check.true(true);
        },
        name: 'eventuallyOk'
    });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert(eventuallyOk);
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

registerTest('execute() normalizes foreign bridge failures under the composite parent', async function () {
    const throwsForeign = defineCompositeAssertion({
        assert(check) {
            return check.fromThrowable('foreign.expectation', function failForeignExpectation() {
                throw new TypeError('wrong shape');
            });
        },
        name: 'throwsForeign'
    });
    const result = await executeSingleBody(function body(testContext: TestContext) {
        testContext.assert.annotated('foreign failed')(throwsForeign);
        return testContext.assert.done();
    });
    const outcome = firstFailOutcome(result);
    const failure = outcome.failures[0];

    if (failure?.kind !== 'assertion') {
        throw new TypeError('Expected assertion failure.');
    }

    const composite = failure.checks[0];
    const child = composite?.kind === 'composite' ? composite.children[0] : null;

    assert.equal(composite?.summary, 'foreign failed');
    assert.equal(child?.kind, 'foreign');
    assert.equal(child?.kind === 'foreign' ? child.label : null, 'foreign.expectation');
    assert.equal(child?.kind === 'foreign' ? child.error.name : null, 'TypeError');
    assert.equal(child?.kind === 'foreign' ? child.error.message : null, 'wrong shape');
});

function actualError(outcome: FailOutcome): Error {
    const failure = outcome.failures[0];

    if (failure?.kind !== 'assertion') {
        throw new TypeError('Expected assertion failure.');
    }

    const check = failure.checks[0];

    if (check?.kind !== 'composite') {
        throw new TypeError('Expected composite failed check.');
    }

    if (
        typeof check.actual === 'object'
        && check.actual !== null
        && 'error' in check.actual
        && check.actual.error instanceof Error
    ) {
        return check.actual.error;
    }

    throw new TypeError('Expected result error.');
}
