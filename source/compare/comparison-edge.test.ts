import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import {
    compareArrayContainsPartial,
    compareDeepValues,
    compareMembersPartialDeepEqual,
    comparePartialValue,
    compareStringEquality
} from './comparison.ts';

registerTest('compareStringEquality() returns no diff for equal strings', function () {
    assert.deepStrictEqual(compareStringEquality('same', 'same'), {
        actual: { kind: 'string', truncation: null, value: 'same' },
        diff: null,
        expected: { kind: 'string', truncation: null, value: 'same' },
        passed: true,
        path: []
    });
});

registerTest('compareDeepValues() rejects mismatched container kinds', function () {
    assert.equal(compareDeepValues([ 1 ], { 0: 1 }).passed, false);
    assert.equal(compareDeepValues(new Map(), new Set()).passed, false);
    assert.equal(compareDeepValues(new Set(), new Map()).passed, false);
    assert.equal(compareDeepValues(new Date(), {}).passed, false);
    assert.equal(compareDeepValues(/a/u, {}).passed, false);
    assert.equal(compareDeepValues(Promise.resolve(), {}).passed, false);
});

registerTest('compareDeepValues() treats unavailable object introspection as a mismatch', function () {
    const ownKeysProxy = new Proxy({}, {
        ownKeys() {
            throw new Error('keys unavailable');
        }
    });
    const prototypeProxy = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('prototype unavailable');
        }
    });

    assert.equal(compareDeepValues(ownKeysProxy, {}).passed, false);
    assert.equal(compareDeepValues(prototypeProxy, {}).passed, false);
});

registerTest('compareDeepValues() emits object remove and add operations', function () {
    const missing = compareDeepValues({ id: 1 }, { id: 1, name: 'Ada' });
    const extra = compareDeepValues({ id: 1, name: 'Ada' }, { id: 1 });

    assert.deepStrictEqual(missing.diff, {
        kind: 'object',
        operations: [
            {
                operation: 'remove',
                path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                value: { kind: 'string', truncation: null, value: 'Ada' }
            }
        ]
    });
    assert.deepStrictEqual(extra.diff, {
        kind: 'object',
        operations: [
            {
                operation: 'add',
                path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                value: { kind: 'string', truncation: null, value: 'Ada' }
            }
        ]
    });
});

registerTest('compareDeepValues() emits array removal for missing actual indexes', function () {
    const result = compareDeepValues([ 1 ], [ 1, 2 ]);

    assert.deepStrictEqual(result.diff, {
        kind: 'array',
        operations: [
            {
                operation: 'remove',
                path: [ { index: 1, kind: 'index' } ],
                value: { kind: 'number', value: 2 }
            }
        ]
    });
});

registerTest('compareDeepValues() handles ArrayBuffer and byte length mismatches', function () {
    const changed = compareDeepValues(Uint8Array.from([ 1 ]).buffer, Uint8Array.from([ 2 ]).buffer);
    const longer = compareDeepValues(Uint8Array.from([ 1, 2 ]), Uint8Array.from([ 1 ]));

    assert.equal(changed.diff?.kind, 'array');
    assert.deepStrictEqual(longer.diff, {
        kind: 'array',
        operations: [
            {
                from: { kind: 'undefined' },
                operation: 'replace',
                path: [ { kind: 'byte', offset: 1 } ],
                to: { kind: 'number', value: 2 }
            }
        ]
    });
});

registerTest('compareDeepValues() reports Error name and enumerable data differences', function () {
    const actual = new Error('same');
    const expected = new Error('same');
    const actualData = Object.assign(new Error('same'), { code: 'actual' }) as Error & { readonly code: string; };
    const expectedData = Object.assign(new Error('same'), { code: 'expected' }) as Error & { readonly code: string; };

    Object.defineProperty(actual, 'name', { value: 'TypeError' });

    assert.equal(compareDeepValues(actual, expected).diff?.kind, 'object');
    assert.deepStrictEqual(compareDeepValues(actualData, expectedData).path, [
        { key: { kind: 'string', value: 'code' }, kind: 'property' }
    ]);
});

registerTest('comparePartialValue() handles primitive, array, built-in, and opaque failures', function () {
    assert.equal(comparePartialValue(1, 2).passed, false);
    assert.equal(comparePartialValue({}, [ 1 ]).passed, false);
    assert.equal(comparePartialValue([ 1 ], [ 1, 2 ]).passed, false);
    assert.equal(comparePartialValue(new Date('2026-07-29'), new Date('2026-07-29')).passed, true);
    assert.equal(comparePartialValue(new Date('2026-07-29'), new Date('2026-07-30')).passed, false);
    assert.equal(comparePartialValue(/a/gu, /a/gu).passed, true);
    assert.equal(comparePartialValue(/a/g, /a/u).passed, false);
    assert.equal(comparePartialValue(Promise.resolve(), Promise.resolve()).passed, false);
});

registerTest('comparePartialValue() preserves repeated reference topology', function () {
    const shared = { value: 1 };
    const actual = { left: shared, right: shared };
    const expected = {
        left: { value: 1 },
        right: { value: 1 }
    };

    assert.equal(comparePartialValue(actual, expected).passed, false);
});

registerTest('comparePartialValue() handles Map, Set, Error, and binary subsets', function () {
    assert.equal(compareDeepValues(new Map([ [ 'id', 1 ] ]), new Map()).passed, false);
    assert.equal(compareDeepValues(new Set([ 1 ]), new Set()).passed, false);
    assert.equal(comparePartialValue({}, new Map()).passed, false);
    assert.equal(comparePartialValue({}, new Set()).passed, false);
    assert.equal(comparePartialValue(new Uint8Array([ 1 ]), new Uint8Array([ 1 ])).passed, true);
    assert.equal(comparePartialValue(new Uint8Array([ 1 ]), new Uint8Array([ 2 ])).passed, false);
    assert.equal(comparePartialValue(new Error('actual'), new Error('expected')).passed, false);
    assert.deepStrictEqual(comparePartialValue(new Map(), new Map([ [ 'id', 1 ] ])).diff, {
        kind: 'map',
        operations: [
            {
                key: { kind: 'string', truncation: null, value: 'id' },
                operation: 'missing-entry',
                value: { kind: 'number', value: 1 }
            }
        ]
    });
    assert.deepStrictEqual(comparePartialValue(new Set(), new Set([ 1 ])).diff, {
        kind: 'set',
        operations: [ { operation: 'missing-member', value: { kind: 'number', value: 1 } } ]
    });
});

registerTest('array membership comparisons report pass and invalid operand cases', function () {
    assert.equal(compareArrayContainsPartial([ { id: 1 } ], { id: 1 }).passed, true);
    assert.equal(compareArrayContainsPartial({ id: 1 }, { id: 1 }).passed, false);
    assert.equal(compareMembersPartialDeepEqual([ { id: 1 } ], { id: 1 }).passed, false);
});
