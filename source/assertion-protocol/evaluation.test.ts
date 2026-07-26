import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import type { AssertAssertionNode } from './types.ts';
import { evaluateAssertion } from './evaluation.ts';

function* values(): Generator<number> {
    yield 1;
    yield 2;
}

type EvaluationCase = {
    readonly assertion: AssertAssertionNode;
    readonly fails: boolean;
};

const passingAssertions: readonly EvaluationCase[] = [
    { assertion: { actual: [ 1 ], check: 'array', message: null, source: 'assert' }, fails: false },
    {
        assertion: {
            actual: [ { id: 1, name: 'Ada' } ],
            check: 'array-contains-partial',
            expected: { id: 1 },
            message: null,
            source: 'assert'
        },
        fails: false
    },
    {
        assertion: { actual: 2, check: 'between', maximum: 3, message: null, minimum: 1, source: 'assert' },
        fails: false
    },
    { assertion: { actual: true, check: 'boolean', message: null, source: 'assert' }, fails: false },
    {
        assertion: {
            actual: new Map([ [ 'a', 1 ] ]),
            check: 'deep-equal',
            expected: new Map([ [ 'a', 1 ] ]),
            message: null,
            source: 'assert'
        },
        fails: false
    },
    { assertion: { actual: 'value', check: 'defined', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: [], check: 'empty', message: null, source: 'assert' }, fails: false },
    {
        assertion: { actual: 'value', check: 'ends-with', expected: 'ue', message: null, source: 'assert' },
        fails: false
    },
    { assertion: { actual: 1, check: 'equal', expected: 1, message: null, source: 'assert' }, fails: false },
    { assertion: { actual: false, check: 'false', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: values, check: 'function', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: 2, check: 'greater-than', expected: 1, message: null, source: 'assert' }, fails: false },
    {
        assertion: { actual: 2, check: 'greater-than-or-equal', expected: 2, message: null, source: 'assert' },
        fails: false
    },
    {
        assertion: { actual: { name: 'Ada' }, check: 'has-property', key: 'name', message: null, source: 'assert' },
        fails: false
    },
    {
        assertion: { actual: 'value', check: 'includes', expected: 'al', message: null, source: 'assert' },
        fails: false
    },
    {
        assertion: {
            actual: new Error('boom'),
            check: 'instance-of',
            expected: Error,
            message: null,
            source: 'assert'
        },
        fails: false
    },
    {
        assertion: { actual: values(), check: 'length', expectedLength: 2, message: null, source: 'assert' },
        fails: false
    },
    { assertion: { actual: 1, check: 'less-than', expected: 2, message: null, source: 'assert' }, fails: false },
    {
        assertion: { actual: 2, check: 'less-than-or-equal', expected: 2, message: null, source: 'assert' },
        fails: false
    },
    { assertion: { actual: 'value', check: 'match', message: null, pattern: /^val/u, source: 'assert' }, fails: false },
    {
        assertion: {
            actual: [ { id: 1, name: 'Ada' } ],
            check: 'members-partial-deep-equal',
            expected: [ { id: 1 } ],
            message: null,
            source: 'assert'
        },
        fails: false
    },
    {
        assertion: { actual: { a: 1 }, check: 'not-deep-equal', expected: { a: 2 }, message: null, source: 'assert' },
        fails: false
    },
    { assertion: { actual: [ 1 ], check: 'not-empty', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: 1, check: 'not-equal', expected: 2, message: null, source: 'assert' }, fails: false },
    {
        assertion: { actual: 'value', check: 'not-match', message: null, pattern: /^other/u, source: 'assert' },
        fails: false
    },
    { assertion: { actual: 'value', check: 'not-null', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: null, check: 'null', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: 1, check: 'number', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: { name: 'Ada' }, check: 'object', message: null, source: 'assert' }, fails: false },
    {
        assertion: {
            actual: { id: 1, name: 'Ada' },
            check: 'partial-deep-equal',
            expected: { id: 1 },
            message: null,
            source: 'assert'
        },
        fails: false
    },
    {
        assertion: { actual: 'value', check: 'starts-with', expected: 'val', message: null, source: 'assert' },
        fails: false
    },
    { assertion: { actual: 'value', check: 'string', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: true, check: 'true', message: null, source: 'assert' }, fails: false },
    { assertion: { actual: undefined, check: 'undefined', message: null, source: 'assert' }, fails: false }
];

const failingAssertions: readonly EvaluationCase[] = [
    { assertion: { actual: {}, check: 'array', message: null, source: 'assert' }, fails: true },
    {
        assertion: {
            actual: [],
            check: 'array-contains-partial',
            expected: { id: 1 },
            message: null,
            source: 'assert'
        },
        fails: true
    },
    {
        assertion: { actual: 4, check: 'between', maximum: 3, message: null, minimum: 1, source: 'assert' },
        fails: true
    },
    { assertion: { actual: 'true', check: 'boolean', message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: { a: 1 }, check: 'deep-equal', expected: { a: 2 }, message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: null, check: 'defined', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: [ 1 ], check: 'empty', message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: 'value', check: 'ends-with', expected: 'al', message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: 1, check: 'equal', expected: 2, message: null, source: 'assert' }, fails: true },
    { assertion: { check: 'fail', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: true, check: 'false', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: 'value', check: 'function', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: 1, check: 'greater-than', expected: 1, message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: 1, check: 'greater-than-or-equal', expected: 2, message: null, source: 'assert' },
        fails: true
    },
    {
        assertion: { actual: { name: 'Ada' }, check: 'has-property', key: 'id', message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: 'value', check: 'includes', expected: 'zz', message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: {}, check: 'instance-of', expected: Error, message: null, source: 'assert' },
        fails: true
    },
    {
        assertion: { actual: values(), check: 'length', expectedLength: 3, message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: 2, check: 'less-than', expected: 2, message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: 3, check: 'less-than-or-equal', expected: 2, message: null, source: 'assert' },
        fails: true
    },
    {
        assertion: { actual: 'value', check: 'match', message: null, pattern: /^other/u, source: 'assert' },
        fails: true
    },
    {
        assertion: {
            actual: [],
            check: 'members-partial-deep-equal',
            expected: [ { id: 1 } ],
            message: null,
            source: 'assert'
        },
        fails: true
    },
    {
        assertion: { actual: { a: 1 }, check: 'not-deep-equal', expected: { a: 1 }, message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: [], check: 'not-empty', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: 1, check: 'not-equal', expected: 1, message: null, source: 'assert' }, fails: true },
    {
        assertion: { actual: 'value', check: 'not-match', message: null, pattern: /^val/u, source: 'assert' },
        fails: true
    },
    { assertion: { actual: null, check: 'not-null', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: undefined, check: 'null', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: Number.NaN, check: 'number', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: [], check: 'object', message: null, source: 'assert' }, fails: true },
    {
        assertion: {
            actual: { id: 2 },
            check: 'partial-deep-equal',
            expected: { id: 1 },
            message: null,
            source: 'assert'
        },
        fails: true
    },
    {
        assertion: { actual: 'value', check: 'starts-with', expected: 'zz', message: null, source: 'assert' },
        fails: true
    },
    { assertion: { actual: 1, check: 'string', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: false, check: 'true', message: null, source: 'assert' }, fails: true },
    { assertion: { actual: null, check: 'undefined', message: null, source: 'assert' }, fails: true }
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
        message: 'custom message',
        source: 'assert'
    }, 7);

    assert.deepStrictEqual(failedCheck, {
        actual: 1,
        expected: 2,
        id: '7',
        location: { column: null, file: '', line: null },
        path: [],
        source: 'assert',
        summary: 'custom message'
    });
});
