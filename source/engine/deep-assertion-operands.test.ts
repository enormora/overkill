import assert from 'node:assert/strict';
import { defineCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { InvalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type { FailOutcome, RunResult } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

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

function assertInvalidDeepAssertionOperand(
    result: RunResult,
    actual: InvalidDeepAssertionOperand
): void {
    assert.deepStrictEqual(firstFailOutcome(result).failures, [
        {
            actual,
            code: 'invalid-deep-assertion-operand',
            expected: 'non-primitive deep assertion operand',
            kind: 'test-contract',
            summary: 'Deep assertions require non-primitive operands.'
        }
    ]);
}

registerTest('execute() rejects primitive facade deep assertion operands at runtime', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        const actual: unknown = 1;

        testScope.assert.deepEqual(actual, { id: 1 });
        return testScope.assert.collect();
    });

    assertInvalidDeepAssertionOperand(result, {
        check: 'deep-equal',
        index: null,
        role: 'actual',
        type: 'number'
    });
});

registerTest('execute() rejects primitive raw deep assertion operands at runtime', async function () {
    const result = await executeSingleBody(function body() {
        return {
            actual: { id: 1 },
            check: 'partial-deep-equal',
            expected: 'id',
            location: unknownSourceLocation,
            message: null,
            source: 'assert'
        };
    });

    assertInvalidDeepAssertionOperand(result, {
        check: 'partial-deep-equal',
        index: null,
        role: 'expected',
        type: 'string'
    });
});

registerTest('execute() rejects primitive composite deep assertion members at runtime', async function () {
    const primitiveMember = defineCompositeAssertion({
        assert(check) {
            const actual: readonly unknown[] = [ 1 ];

            return check.arrayContainsPartial(actual, { id: 1 });
        },
        name: 'primitiveMember'
    });
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(primitiveMember);
        return testScope.assert.collect();
    });

    assertInvalidDeepAssertionOperand(result, {
        check: 'array-contains-partial',
        index: 0,
        role: 'actual',
        type: 'number'
    });
});

registerTest('execute() rejects primitive async composite deep assertion members at runtime', async function () {
    const primitiveExpectedMember = defineCompositeAssertion({
        async assert(check) {
            const expected: readonly unknown[] = [ 1 ];

            await Promise.resolve();
            return check.membersPartialDeepEqual([ { id: 1 } ], expected);
        },
        name: 'primitiveExpectedMember'
    });
    const result = await executeSingleBody(async function body(testScope: TestScope) {
        await testScope.assert(primitiveExpectedMember);
        return testScope.assert.collect();
    });

    assertInvalidDeepAssertionOperand(result, {
        check: 'members-partial-deep-equal',
        index: 0,
        role: 'expected',
        type: 'number'
    });
});
