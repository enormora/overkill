import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { serializeValue } from '../compare/serialized-value.ts';
import { createCompositeCheckBuilder } from '../assert/assertion-extension.ts';
import type { AssertAssertionNode, CompositeAssertionChildNode, CompositeAssertionNode } from './assertion-node.ts';
import type { FailedCompositeCheck } from './assertion-node-shape.ts';
import { evaluateAssertion, invalidDeepAssertionOperand } from './evaluation.ts';
import { unknownSourceLocation } from './source-location.ts';
import { createThrownMatcherAssertion } from './thrown-matcher.ts';

function* values(): Generator<number> {
    yield 1;
    yield 2;
}

const check = createCompositeCheckBuilder('assert', null, unknownSourceLocation);

type EvaluationCase = {
    readonly assertion: AssertAssertionNode;
    readonly fails: boolean;
};

type DeepCheckByName = {
    readonly arrayContainsPartial: 'array-contains-partial';
    readonly deepEqual: 'deep-equal';
    readonly membersPartialDeepEqual: 'members-partial-deep-equal';
    readonly notDeepEqual: 'not-deep-equal';
    readonly partialDeepEqual: 'partial-deep-equal';
};

type DeepCheck = DeepCheckByName[keyof DeepCheckByName];

function deepAssertion(
    checkName: DeepCheck,
    actual: unknown,
    expected: unknown
): CompositeAssertionChildNode<'assert'> {
    return {
        actual,
        check: checkName,
        expected,
        location: unknownSourceLocation,
        message: null,
        source: 'assert'
    };
}

function compositeAssertion(
    children: readonly [CompositeAssertionChildNode<'assert'>, ...CompositeAssertionChildNode<'assert'>[]]
): CompositeAssertionNode<'assert'> {
    return {
        actual: 'composite',
        check: 'composite',
        children,
        expected: 'pass',
        location: unknownSourceLocation,
        message: null,
        name: 'composite',
        source: 'assert',
        summary: 'Expected composite assertion to pass.'
    };
}

function compositeFailure(assertion: CompositeAssertionNode<'assert'>): FailedCompositeCheck {
    const failedCheck = evaluateAssertion(assertion, 1);

    if (failedCheck?.kind === 'composite') {
        return failedCheck;
    }

    throw new TypeError('Expected composite assertion failure.');
}

const passingAssertions: readonly EvaluationCase[] = [
    { assertion: check.array([ 1 ]), fails: false },
    { assertion: check.arrayContainsPartial([ { id: 1, name: 'Ada' } ], { id: 1 }), fails: false },
    { assertion: check.between(2, 1, 3), fails: false },
    { assertion: check.boolean(true), fails: false },
    { assertion: check.deepEqual(new Map([ [ 'a', 1 ] ]), new Map([ [ 'a', 1 ] ])), fails: false },
    { assertion: check.defined('value'), fails: false },
    { assertion: check.empty([]), fails: false },
    { assertion: check.endsWith('value', 'ue'), fails: false },
    { assertion: check.equal(1, 1), fails: false },
    { assertion: check.false(false), fails: false },
    { assertion: check.function(values), fails: false },
    { assertion: check.greaterThan(2, 1), fails: false },
    { assertion: check.greaterThanOrEqual(2, 2), fails: false },
    { assertion: check.hasProperty({ name: 'Ada' }, 'name'), fails: false },
    { assertion: check.includes('value', 'al'), fails: false },
    { assertion: check.instanceOf(new Error('boom'), Error), fails: false },
    { assertion: check.length(values(), 2), fails: false },
    { assertion: check.lessThan(1, 2), fails: false },
    { assertion: check.lessThanOrEqual(2, 2), fails: false },
    { assertion: check.match('value', /^val/u), fails: false },
    { assertion: check.membersPartialDeepEqual([ { id: 1, name: 'Ada' } ], [ { id: 1 } ]), fails: false },
    { assertion: check.notDeepEqual({ a: 1 }, { a: 2 }), fails: false },
    { assertion: check.notEmpty([ 1 ]), fails: false },
    { assertion: check.notEqual(1, 2), fails: false },
    { assertion: check.notMatch('value', /^other/u), fails: false },
    { assertion: check.notNull('value'), fails: false },
    { assertion: check.null(null), fails: false },
    { assertion: check.number(1), fails: false },
    { assertion: check.object({ name: 'Ada' }), fails: false },
    { assertion: check.partialDeepEqual({ id: 1, name: 'Ada' }, { id: 1 }), fails: false },
    { assertion: check.startsWith('value', 'val'), fails: false },
    { assertion: check.string('value'), fails: false },
    { assertion: check.true(true), fails: false },
    { assertion: check.undefined(undefined), fails: false }
];

const failingAssertions: readonly EvaluationCase[] = [
    { assertion: check.array({}), fails: true },
    { assertion: check.arrayContainsPartial([], { id: 1 }), fails: true },
    { assertion: check.between(4, 1, 3), fails: true },
    { assertion: check.boolean('true'), fails: true },
    { assertion: check.deepEqual({ a: 1 }, { a: 2 }), fails: true },
    { assertion: check.defined(null), fails: true },
    { assertion: check.empty([ 1 ]), fails: true },
    { assertion: check.endsWith('value', 'al'), fails: true },
    { assertion: check.equal(1, 2), fails: true },
    { assertion: check.fail(), fails: true },
    { assertion: check.false(true), fails: true },
    { assertion: check.function('value'), fails: true },
    { assertion: check.greaterThan(1, 1), fails: true },
    { assertion: check.greaterThanOrEqual(1, 2), fails: true },
    { assertion: check.hasProperty({ name: 'Ada' }, 'id'), fails: true },
    { assertion: check.includes('value', 'zz'), fails: true },
    { assertion: check.instanceOf({}, Error), fails: true },
    { assertion: check.length(values(), 3), fails: true },
    { assertion: check.lessThan(2, 2), fails: true },
    { assertion: check.lessThanOrEqual(3, 2), fails: true },
    { assertion: check.match('value', /^other/u), fails: true },
    { assertion: check.membersPartialDeepEqual([], [ { id: 1 } ]), fails: true },
    { assertion: check.notDeepEqual({ a: 1 }, { a: 1 }), fails: true },
    { assertion: check.notEmpty([]), fails: true },
    { assertion: check.notEqual(1, 1), fails: true },
    { assertion: check.notMatch('value', /^val/u), fails: true },
    { assertion: check.notNull(null), fails: true },
    { assertion: check.null(undefined), fails: true },
    { assertion: check.number(Number.NaN), fails: true },
    { assertion: check.object([]), fails: true },
    { assertion: check.partialDeepEqual({ id: 2 }, { id: 1 }), fails: true },
    { assertion: check.startsWith('value', 'zz'), fails: true },
    { assertion: check.string(1), fails: true },
    { assertion: check.true(false), fails: true },
    { assertion: check.undefined(null), fails: true }
];

export const testSuite = createOverkillSuite({
    name: 'source/assertion-protocol/evaluation.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'evaluateAssertion() passes built-in catalog assertions with strict semantics',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    passingAssertions.map(function toEvaluation(testCase) {
                        return evaluateAssertion(testCase.assertion, 1) === null;
                    }),
                    passingAssertions.map(function toExpectedPass() {
                        return true;
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() fails built-in catalog assertions with source-aware checks',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    failingAssertions.map(function toEvaluation(testCase) {
                        return evaluateAssertion(testCase.assertion, 1) !== null;
                    }),
                    failingAssertions.map(function toExpectedFailure() {
                        return true;
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() preserves custom messages and assertion source',
            metadata: {},
            body(scope: OverkillScope) {
                const failedCheck = evaluateAssertion({
                    actual: 1,
                    check: 'equal',
                    expected: 2,
                    location: unknownSourceLocation,
                    message: 'custom message',
                    source: 'assert'
                }, 7);

                scope.require.notNull(failedCheck);
                scope.assert.deepEqual(failedCheck, {
                    actual: serializeValue(1),
                    diff: null,
                    expected: serializeValue(2),
                    id: '7',
                    kind: 'leaf',
                    location: unknownSourceLocation,
                    path: [],
                    source: 'assert',
                    summary: 'custom message'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() reports unsupported collection operands',
            metadata: {},
            body(scope: OverkillScope) {
                const failedChecks = [
                    evaluateAssertion(check.empty(42), 1),
                    evaluateAssertion(check.length(42, 0), 2),
                    evaluateAssertion(check.notEmpty(42), 3)
                ];

                scope.assert.deepEqual(
                    failedChecks.map(function toActual(failedCheck) {
                        return failedCheck?.actual;
                    }),
                    [
                        serializeValue(42),
                        serializeValue(42),
                        serializeValue(42)
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() passes thrown matcher composites',
            metadata: {},
            async body(scope: OverkillScope) {
                const exactAssertion = createThrownMatcherAssertion({
                    kind: 'rejects',
                    location: unknownSourceLocation,
                    matcher: { exact: 'expected' },
                    message: null,
                    observation: { status: 'rejected', value: 'expected' },
                    source: 'assert'
                });
                const errorGroup = check.throws(function throwExpectedError() {
                    throw Object.assign(new SyntaxError('invalid header'), { code: 'EINVAL' });
                }, {
                    code: 'EINVAL',
                    message: /invalid/u,
                    name: 'SyntaxError',
                    type: SyntaxError
                });
                const rejectsGroup = await check.rejects(async function rejectExpectedError() {
                    await Promise.reject(new Error('expected', { cause: 'raw cause' }));
                }, { cause: { exact: 'raw cause' }, message: 'expected' });

                scope.assert.equal(evaluateAssertion(exactAssertion, 1), null);
                scope.assert.equal(evaluateAssertion(compositeAssertion(errorGroup.children), 1), null);
                scope.assert.equal(evaluateAssertion(compositeAssertion(rejectsGroup.children), 1), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() reports thrown matcher field failures',
            metadata: {},
            body(scope: OverkillScope) {
                const group = check.throws(function throwMismatchedError() {
                    throw Object.assign(new TypeError('actual'), { code: 'ACTUAL' });
                }, {
                    code: 'EXPECTED',
                    message: 'expected',
                    name: 'RangeError',
                    type: RangeError
                });
                const failure = compositeFailure(compositeAssertion(group.children));

                scope.assert.deepEqual(
                    failure.children.map(function summaryOf(child) {
                        return child.summary;
                    }),
                    [
                        'Expected thrown value to be an instance of the constructor.',
                        'Expected thrown value message to equal the string.',
                        'Expected thrown value code to equal the string.',
                        'Expected thrown value name to equal the string.'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'evaluateAssertion() reports missing and non-error thrown values',
            metadata: {},
            body(scope: OverkillScope) {
                const missingGroup = check.throws(function returnNormally() {
                    return 'value';
                }, { exact: 'expected' });
                const nonErrorAssertion = createThrownMatcherAssertion({
                    kind: 'rejects',
                    location: unknownSourceLocation,
                    matcher: { message: 'raw' },
                    message: null,
                    observation: { status: 'rejected', value: 'raw' },
                    source: 'assert'
                });

                scope.assert.deepEqual(
                    compositeFailure(compositeAssertion(missingGroup.children)).children.map(function summaryOf(child) {
                        return child.summary;
                    }),
                    [ 'Expected function to throw.' ]
                );
                scope.assert.deepEqual(
                    compositeFailure(nonErrorAssertion).children.map(function summaryOf(child) {
                        return child.summary;
                    }),
                    [ 'Expected thrown value to be an Error.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'invalidDeepAssertionOperand() accepts structural and reference operands',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(invalidDeepAssertionOperand(check.deepEqual({ id: 1 }, { id: 1 })), null);
                scope.assert.equal(invalidDeepAssertionOperand(check.deepEqual(values, values)), null);
                scope.assert.equal(
                    invalidDeepAssertionOperand(check.arrayContainsPartial([ { id: 1 } ], { id: 1 })),
                    null
                );
                scope.assert.equal(
                    invalidDeepAssertionOperand(check.membersPartialDeepEqual([ { id: 1 } ], [ { id: 1 } ])),
                    null
                );
                scope.assert.equal(invalidDeepAssertionOperand(check.equal(1, 1)), null);
                scope.assert.equal(invalidDeepAssertionOperand(compositeAssertion([ check.true(true) ])), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'invalidDeepAssertionOperand() reports primitive exact deep operands',
            metadata: {},
            body(scope: OverkillScope) {
                const nullOperand = invalidDeepAssertionOperand(deepAssertion('deep-equal', null, {}));
                const undefinedOperand = invalidDeepAssertionOperand(deepAssertion('not-deep-equal', {}, undefined));
                const symbolOperand = invalidDeepAssertionOperand(
                    deepAssertion('partial-deep-equal', Symbol('id'), {})
                );

                scope.require.notNull(nullOperand);
                scope.assert.deepEqual(nullOperand, {
                    check: 'deep-equal',
                    index: null,
                    role: 'actual',
                    type: 'null'
                });
                scope.require.notNull(undefinedOperand);
                scope.assert.deepEqual(undefinedOperand, {
                    check: 'not-deep-equal',
                    index: null,
                    role: 'expected',
                    type: 'undefined'
                });
                scope.require.notNull(symbolOperand);
                scope.assert.deepEqual(symbolOperand, {
                    check: 'partial-deep-equal',
                    index: null,
                    role: 'actual',
                    type: 'symbol'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'invalidDeepAssertionOperand() reports primitive partial member operands',
            metadata: {},
            body(scope: OverkillScope) {
                const actualOperand = invalidDeepAssertionOperand(
                    deepAssertion('array-contains-partial', 1, { id: 1 })
                );
                const expectedOperand = invalidDeepAssertionOperand(
                    deepAssertion('array-contains-partial', [ { id: 1 } ], true)
                );
                const memberOperand = invalidDeepAssertionOperand(
                    deepAssertion('members-partial-deep-equal', [ { id: 1 } ], 1n)
                );

                scope.require.notNull(actualOperand);
                scope.assert.deepEqual(actualOperand, {
                    check: 'array-contains-partial',
                    index: null,
                    role: 'actual',
                    type: 'number'
                });
                scope.require.notNull(expectedOperand);
                scope.assert.deepEqual(expectedOperand, {
                    check: 'array-contains-partial',
                    index: null,
                    role: 'expected',
                    type: 'boolean'
                });
                scope.require.notNull(memberOperand);
                scope.assert.deepEqual(memberOperand, {
                    check: 'members-partial-deep-equal',
                    index: null,
                    role: 'expected',
                    type: 'bigint'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'invalidDeepAssertionOperand() reports primitive composite child operands',
            metadata: {},
            body(scope: OverkillScope) {
                const operand = invalidDeepAssertionOperand(compositeAssertion([
                    check.true(true),
                    deepAssertion('members-partial-deep-equal', [ { id: 1 } ], [ 'id' ])
                ]));

                scope.require.notNull(operand);
                scope.assert.deepEqual(operand, {
                    check: 'members-partial-deep-equal',
                    index: 0,
                    role: 'expected',
                    type: 'string'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
