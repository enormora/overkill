import { suite, test, type TestScope } from '@overkill-dev/test';
import { defineCompositeAssertion as defineSubjectCompositeAssertion } from '../assert/assertion-extension.ts';
import type { BuiltInAssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { FailOutcome, RunResult } from './run-result.ts';
import { executeSingleBody } from '../test-support/execute-assertion-case.ts';

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const outcome = result.perTest[0]?.outcome;
    return outcome?.kind === 'fail' ? outcome : null;
}

const asyncChild = defineSubjectCompositeAssertion({
    name: 'async diagnostic',
    async assert(check, value: number) {
        const foreign = await check.fromRejectable('async expectation', async function resolveExpectation() {
            await Promise.resolve();
        });
        return check.group([ check.equal(value, 1), foreign ]);
    }
});

export const testNode = suite('Nested assertion contexts', [
    test('owns parallel async custom diagnostics without adding plan units', async function (scope) {
        const result = await executeSingleBody(async function (body) {
            body.plan(2);
            await Promise.all([ body.assert(asyncChild, 1), body.assert(asyncChild, 1) ]);
            return body.assert.collect();
        });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('retains a caught captured facade violation across an await', async function (scope) {
        const result = await executeSingleBody(async function (body) {
            const recordOutside = body.assert.true;
            const reference = defineSubjectCompositeAssertion({
                name: 'captured facade',
                async assert(check) {
                    await Promise.resolve();
                    try {
                        recordOutside(true);
                    } catch {
                        return check.true(true);
                    }
                    return check.fail();
                }
            });
            body.plan(1);
            await body.assert(reference);
            return body.assert.collect();
        });
        scope.assert.deepEqual(
            firstFailOutcome(result)?.failures.map(function code(failure) {
                return failure.kind === 'test-contract' ? failure.code : failure.kind;
            }) ?? [],
            [ 'invalid-assertion-context' ]
        );
        return scope.assert.collect();
    }),
    test('rejects an injected diagnostic returned by a different invocation', async function (scope: TestScope) {
        const result = await executeSingleBody(function (body) {
            const retained: BuiltInAssertAssertionNode[] = [];
            const reference = defineSubjectCompositeAssertion({
                name: 'retained diagnostic',
                assert(check) {
                    const previous = retained[0];
                    if (previous !== undefined) {
                        return previous;
                    }
                    const diagnostic = check.true(true);
                    retained.push(diagnostic);
                    return diagnostic;
                }
            });
            body.assert(reference);
            body.assert(reference);
            return body.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        const [ failure ] = outcome.failures;
        scope.assert.equal(failure.kind === 'test-contract' ? failure.code : failure.kind, 'invalid-assertion-context');
        return scope.assert.collect();
    })
]);
