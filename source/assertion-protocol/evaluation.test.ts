import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import type { AssertAssertionNode } from './assertion-node.ts';
import { createCompositeCheckBuilder } from './assertion-reference.ts';
import { evaluateAssertion } from './evaluation.ts';
import { unknownSourceLocation } from './source-location.ts';

function* values(): Generator<number> {
    yield 1;
    yield 2;
}

const check = createCompositeCheckBuilder('assert', null, unknownSourceLocation);

type EvaluationCase = {
    readonly assertion: AssertAssertionNode;
    readonly fails: boolean;
};

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

registerTest('evaluateAssertion() passes built-in catalog assertions with strict semantics', function () {
    assert.deepStrictEqual(
        passingAssertions.map(function toEvaluation(testCase) {
            return evaluateAssertion(testCase.assertion, 1) === null;
        }),
        passingAssertions.map(function toExpectedPass() {
            return true;
        })
    );
});

registerTest('evaluateAssertion() fails built-in catalog assertions with source-aware checks', function () {
    assert.deepStrictEqual(
        failingAssertions.map(function toEvaluation(testCase) {
            return evaluateAssertion(testCase.assertion, 1) !== null;
        }),
        failingAssertions.map(function toExpectedFailure() {
            return true;
        })
    );
});

registerTest('evaluateAssertion() preserves custom messages and assertion source', function () {
    const failedCheck = evaluateAssertion({
        actual: 1,
        check: 'equal',
        expected: 2,
        location: unknownSourceLocation,
        message: 'custom message',
        source: 'assert'
    }, 7);

    assert.deepStrictEqual(failedCheck, {
        actual: 1,
        expected: 2,
        id: '7',
        kind: 'leaf',
        location: unknownSourceLocation,
        path: [],
        source: 'assert',
        summary: 'custom message'
    });
});
