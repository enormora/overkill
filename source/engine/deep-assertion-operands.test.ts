import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import {
    requireEngineNarrowingReference,
    requireEngineCompositeReference
} from '../test-support/assertion-reference-boundary.ts';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import { defineCompositeAssertion, defineNarrowingCompositeAssertion } from '@overkill-dev/test/assert';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';

import type { InvalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type { FailOutcome, RunResult, TestOutcome } from './run-result.ts';

const failOutcome = defineNarrowingCompositeAssertion<TestOutcome, FailOutcome, readonly []>({
    name: 'fail outcome',
    narrows(actual): actual is FailOutcome {
        return actual.kind === 'fail';
    }
});
requireEngineNarrowingReference(failOutcome);

function firstOutcome(result: RunResult): TestOutcome | undefined {
    return result.perTest.at(0)?.outcome ?? undefined;
}

async function executeSingleBody(body: EngineCaseBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body,
                        annotations: {},
                        controls: {},
                        title: 'case'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
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

export const testNode: TestNode = suite('Deep assertion operands', [
    test(
        'rejects primitive facade deep assertion operands at runtime',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
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
    ),
    test('rejects primitive raw deep assertion operands at runtime', async function (scope: TestScope) {
        const result = await executeSingleBody(function body() {
            return {
                actual: { id: 1 },
                check: 'partial-deep-equal',
                expected: 'id',
                message: null,
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
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
    }),
    test(
        'rejects primitive composite deep assertion members at runtime',
        async function (scope: TestScope) {
            const primitiveMember = defineCompositeAssertion({
                assert(check) {
                    const actual: readonly unknown[] = [ 1 ];

                    return check.arrayContainsPartial(actual, { id: 1 });
                },
                name: 'primitiveMember'
            });
            requireEngineCompositeReference(primitiveMember);
            const result = await executeSingleBody(function testBody(testScope) {
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
    ),
    test(
        'rejects primitive async composite deep assertion members at runtime',
        async function (scope: TestScope) {
            const primitiveExpectedMember = defineCompositeAssertion({
                async assert(check) {
                    const expected: readonly unknown[] = [ 1 ];

                    await Promise.resolve();
                    return check.membersPartialDeepEqual([ { id: 1 } ], expected);
                },
                name: 'primitiveExpectedMember'
            });
            requireEngineCompositeReference(primitiveExpectedMember);
            const result = await executeSingleBody(async function testBody(testScope) {
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
    )
]);
