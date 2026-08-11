import { defineNarrowingCompositeAssertion } from '@overkill-dev/assert';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { defineCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { InvalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type { FailOutcome, RunResult, TestOutcome } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

const failOutcome = defineNarrowingCompositeAssertion<TestOutcome, FailOutcome, readonly []>({
    name: 'fail outcome',
    narrows(actual): actual is FailOutcome {
        return actual.kind === 'fail';
    }
});

function firstOutcome(result: RunResult): TestOutcome | undefined {
    return result.perTest.at(0)?.outcome;
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
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

function expectedInvalidDeepAssertionOperand(
    actual: InvalidDeepAssertionOperand
): FailOutcome['failures'] {
    return [
        {
            actual,
            code: 'invalid-deep-assertion-operand',
            expected: 'non-primitive deep assertion operand',
            kind: 'test-contract',
            summary: 'Deep assertions require non-primitive operands.'
        }
    ];
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/deep-assertion-operands.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() rejects primitive facade deep assertion operands at runtime',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const actual: unknown = 1;

                    testScope.assert.deepEqual(actual, { id: 1 });
                    return testScope.assert.collect();
                });

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                scope.assert.deepEqual(
                    outcome.failures,
                    expectedInvalidDeepAssertionOperand({
                        check: 'deep-equal',
                        index: null,
                        role: 'actual',
                        type: 'number'
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects primitive raw deep assertion operands at runtime',
            metadata: {},
            async body(scope: OverkillScope) {
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

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                scope.assert.deepEqual(
                    outcome.failures,
                    expectedInvalidDeepAssertionOperand({
                        check: 'partial-deep-equal',
                        index: null,
                        role: 'expected',
                        type: 'string'
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects primitive composite deep assertion members at runtime',
            metadata: {},
            async body(scope: OverkillScope) {
                const primitiveMember = defineCompositeAssertion({
                    assert(check) {
                        const actual: readonly unknown[] = [ 1 ];

                        return check.arrayContainsPartial(actual, { id: 1 });
                    },
                    name: 'primitiveMember'
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(primitiveMember);
                    return testScope.assert.collect();
                });

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                scope.assert.deepEqual(
                    outcome.failures,
                    expectedInvalidDeepAssertionOperand({
                        check: 'array-contains-partial',
                        index: 0,
                        role: 'actual',
                        type: 'number'
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects primitive async composite deep assertion members at runtime',
            metadata: {},
            async body(scope: OverkillScope) {
                const primitiveExpectedMember = defineCompositeAssertion({
                    async assert(check) {
                        const expected: readonly unknown[] = [ 1 ];

                        await Promise.resolve();
                        return check.membersPartialDeepEqual([ { id: 1 } ], expected);
                    },
                    name: 'primitiveExpectedMember'
                });
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    await testScope.assert(primitiveExpectedMember);
                    return testScope.assert.collect();
                });

                const outcome = firstOutcome(result);
                scope.require.defined(outcome);
                scope.require(failOutcome, outcome);
                scope.assert.deepEqual(
                    outcome.failures,
                    expectedInvalidDeepAssertionOperand({
                        check: 'members-partial-deep-equal',
                        index: 0,
                        role: 'expected',
                        type: 'number'
                    })
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
