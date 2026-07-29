import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import {
    compareArrayContainsPartial,
    compareDeepValues,
    compareEqualValues,
    compareMembersPartialDeepEqual,
    comparePartialValue,
    compareStringEquality
} from './comparison.ts';

registerTest('compareEqualValues() uses Object.is primitive semantics', function () {
    assert.equal(compareEqualValues(Number.NaN, Number.NaN).passed, true);
    assert.equal(compareEqualValues(-0, 0).passed, false);
    assert.equal(compareEqualValues(42, 42n).passed, false);

    const symbol = Symbol('same');
    assert.equal(compareEqualValues(symbol, symbol).passed, true);
    assert.equal(compareEqualValues(Symbol('same'), Symbol('same')).passed, false);

    const functionValue = function namedFunction(): number {
        return 1;
    };
    assert.equal(compareEqualValues(functionValue, functionValue).passed, true);
    assert.equal(
        compareEqualValues(function namedFunction() {
            return 1;
        }, function namedFunction() {
            return 1;
        })
            .passed,
        false
    );
});

registerTest('compareStringEquality() emits bounded string hunks for string equality failures only', function () {
    const result = compareStringEquality('first\nactual\nlast', 'first\nexpected\nlast');

    assert.equal(result.passed, false);
    assert.deepStrictEqual(result.path, []);
    assert.deepStrictEqual(result.diff, {
        actual: 'first\nactual\nlast',
        expected: 'first\nexpected\nlast',
        hunks: [
            {
                actualStart: 1,
                added: [ 'actual' ],
                expectedStart: 1,
                removed: [ 'expected' ]
            }
        ],
        kind: 'string'
    });
    assert.equal(compareEqualValues('actual', 'expected').diff, null);
});

registerTest('compareDeepValues() distinguishes numeric and primitive edge cases', function () {
    assert.equal(compareDeepValues(Number.NaN, Number.NaN).passed, true);
    assert.equal(compareDeepValues(-0, 0).passed, false);
    assert.deepStrictEqual(compareDeepValues(-0, 0).diff, {
        actual: { kind: 'number', value: '-0' },
        expected: { kind: 'number', value: 0 },
        kind: 'value'
    });
    assert.equal(compareDeepValues(42, 42n).passed, false);
});

registerTest('compareDeepValues() compares arrays including holes, undefined, length, and paths', function () {
    const hole: unknown[] = [];
    hole.length = 1;

    const undefinedValue = [ undefined ];
    const holeResult = compareDeepValues(undefinedValue, hole);
    const nestedResult = compareDeepValues([ { count: 1 } ], [ { count: 2 } ]);
    const lengthResult = compareDeepValues([ 1, 2 ], [ 1 ]);

    assert.equal(holeResult.passed, false);
    assert.deepStrictEqual(holeResult.path, [ { index: 0, kind: 'index' } ]);
    assert.deepStrictEqual(nestedResult.path, [ { index: 0, kind: 'index' } ]);
    assert.deepStrictEqual(lengthResult.diff, {
        kind: 'array',
        operations: [
            {
                operation: 'add',
                path: [ { index: 1, kind: 'index' } ],
                value: { kind: 'number', value: 2 }
            }
        ]
    });
});

registerTest('compareDeepValues() compares enumerable string and symbol data without invoking accessors', function () {
    const symbolKey = Symbol('id');
    const actual = {
        [symbolKey]: 1,
        get danger() {
            throw new Error('getter must not run');
        }
    };
    const expected = {
        [symbolKey]: 2,
        get danger() {
            throw new Error('getter must not run');
        }
    };

    Object.defineProperty(actual, 'hidden', { enumerable: false, value: 1 });
    Object.defineProperty(expected, 'hidden', { enumerable: false, value: 2 });

    const result = compareDeepValues(actual, expected);

    assert.equal(result.passed, false);
    assert.deepStrictEqual(result.path, [ { key: { kind: 'symbol', value: 'Symbol(id)' }, kind: 'property' } ]);
    assert.deepStrictEqual(result.diff, {
        kind: 'object',
        operations: [
            {
                from: { kind: 'number', value: 2 },
                operation: 'replace',
                path: [ { key: { kind: 'symbol', value: 'Symbol(id)' }, kind: 'property' } ],
                to: { kind: 'number', value: 1 }
            }
        ]
    });
});

registerTest('compareDeepValues() ignores non-enumerable properties', function () {
    const actual = {};
    const expected = {};
    Object.defineProperty(actual, 'hidden', { enumerable: false, value: 1 });
    Object.defineProperty(expected, 'hidden', { enumerable: false, value: 2 });

    assert.equal(compareDeepValues(actual, expected).passed, true);
});

registerTest('compareDeepValues() requires matching class prototypes before enumerable data comparison', function () {
    const actual = { id: 1 };
    const expected = { id: 1 };
    Object.setPrototypeOf(actual, { constructor: { name: 'Actual' } });
    Object.setPrototypeOf(expected, { constructor: { name: 'Expected' } });

    const result = compareDeepValues(actual, expected);
    const { diff } = result;

    assert.equal(result.passed, false);
    assert.ok(diff !== null);
    assert.equal(diff.kind, 'value');
});

registerTest('compareDeepValues() compares Map entries order independently with deep keys and values', function () {
    const actual = new Map<unknown, unknown>([
        [ { id: 2 }, { name: 'Grace' } ],
        [ { id: 1 }, { name: 'Ada' } ]
    ]);
    const expected = new Map<unknown, unknown>([
        [ { id: 1 }, { name: 'Ada' } ],
        [ { id: 2 }, { name: 'Grace' } ]
    ]);
    const changed = new Map<unknown, unknown>([
        [ { id: 1 }, { name: 'Ada' } ],
        [ { id: 2 }, { name: 'Katherine' } ]
    ]);
    assert.equal(compareDeepValues(actual, expected).passed, true);

    const changedResult = compareDeepValues(actual, changed);
    assert.equal(changedResult.passed, false);
    assert.deepStrictEqual(changedResult.path, [
        {
            key: {
                constructorName: 'Object',
                entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 2 } } ],
                kind: 'object',
                truncation: null
            },
            kind: 'map-value'
        }
    ]);
});

registerTest('compareDeepValues() reports missing Map entries by key', function () {
    const actual = new Map<unknown, unknown>([
        [ { id: 2 }, { name: 'Grace' } ],
        [ { id: 1 }, { name: 'Ada' } ]
    ]);
    const expected = new Map<unknown, unknown>([
        [ { id: 1 }, { name: 'Ada' } ],
        [ { id: 3 }, { name: 'Katherine' } ]
    ]);
    const missingResult = compareDeepValues(actual, expected);
    const missingDiff = missingResult.diff;

    assert.equal(missingResult.passed, false);
    assert.ok(missingDiff !== null);

    if (missingDiff.kind !== 'map') {
        assert.fail(`expected map diff, received ${missingDiff.kind}`);
    }

    assert.equal(missingDiff.operations[0]?.operation, 'remove');
});

registerTest('compareDeepValues() compares Set members order independently with deep values', function () {
    const actual = new Set<unknown>([ { id: 2 }, { id: 1 } ]);
    const expected = new Set<unknown>([ { id: 1 }, { id: 2 } ]);
    const changed = new Set<unknown>([ { id: 1 }, { id: 3 } ]);

    assert.equal(compareDeepValues(actual, expected).passed, true);

    const result = compareDeepValues(actual, changed);
    assert.equal(result.passed, false);
    assert.deepStrictEqual(result.diff, {
        kind: 'set',
        operations: [
            {
                operation: 'remove',
                path: [
                    {
                        kind: 'set-value',
                        value: {
                            constructorName: 'Object',
                            entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 3 } } ],
                            kind: 'object',
                            truncation: null
                        }
                    }
                ],
                value: {
                    constructorName: 'Object',
                    entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 3 } } ],
                    kind: 'object',
                    truncation: null
                }
            },
            {
                operation: 'add',
                path: [
                    {
                        kind: 'set-value',
                        value: {
                            constructorName: 'Object',
                            entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 2 } } ],
                            kind: 'object',
                            truncation: null
                        }
                    }
                ],
                value: {
                    constructorName: 'Object',
                    entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 2 } } ],
                    kind: 'object',
                    truncation: null
                }
            }
        ]
    });
});

registerTest('compareDeepValues() compares Date, RegExp, and Error identity', function () {
    const firstError = Object.assign(new TypeError('bad value'), { code: 'A' }) as TypeError & {
        readonly code: string;
    };
    const secondError = Object.assign(new TypeError('bad value'), { code: 'A' }) as TypeError & {
        readonly code: string;
    };

    assert.equal(
        compareDeepValues(new Date('2026-07-29T00:00:00.000Z'), new Date('2026-07-29T00:00:00.000Z')).passed,
        true
    );
    assert.equal(
        compareDeepValues(new Date('2026-07-29T00:00:00.000Z'), new Date('2026-07-30T00:00:00.000Z')).passed,
        false
    );
    assert.equal(compareDeepValues(/abc/giu, /abc/giu).passed, true);
    assert.equal(compareDeepValues(/abc/giu, /abc/gi).passed, false);
    assert.equal(compareDeepValues(firstError, secondError).passed, true);
    assert.deepStrictEqual(compareDeepValues(new Error('actual'), new Error('expected')).diff, {
        kind: 'object',
        operations: [
            {
                from: { kind: 'string', truncation: null, value: 'expected' },
                operation: 'replace',
                path: [ { key: { kind: 'string', value: 'message' }, kind: 'property' } ],
                to: { kind: 'string', truncation: null, value: 'actual' }
            }
        ]
    });
});

registerTest('compareDeepValues() compares opaque built-ins by reference identity', function () {
    const promise = Promise.resolve();
    const weakMap = new WeakMap<Record<string, unknown>, unknown>();
    const weakSet = new WeakSet<Record<string, unknown>>();

    assert.equal(compareDeepValues(promise, promise).passed, true);
    assert.equal(compareDeepValues(Promise.resolve(), Promise.resolve()).passed, false);
    assert.equal(compareDeepValues(weakMap, weakMap).passed, true);
    assert.equal(
        compareDeepValues(
            new WeakMap<Record<string, unknown>, unknown>(),
            new WeakMap<Record<string, unknown>, unknown>()
        )
            .passed,
        false
    );
    assert.equal(compareDeepValues(weakSet, weakSet).passed, true);
    assert.equal(
        compareDeepValues(new WeakSet<Record<string, unknown>>(), new WeakSet<Record<string, unknown>>()).passed,
        false
    );
});

registerTest('compareDeepValues() preserves repeated reference topology', function () {
    const actualShared = { left: null, right: null };
    const expectedShared = { left: null, right: null };
    const actual = { left: actualShared, right: actualShared };
    const expected = { left: expectedShared, right: expectedShared };
    const mismatchedExpected = {
        left: { left: null, right: null },
        right: { left: null, right: null }
    };
    assert.equal(compareDeepValues(actual, expected).passed, true);
    assert.equal(compareDeepValues(actual, mismatchedExpected).passed, false);
});

registerTest('compareDeepValues() preserves cycle topology', function () {
    const actualCycle = {};
    const expectedCycle = {};
    Object.defineProperty(actualCycle, 'left', { enumerable: true, value: actualCycle });
    Object.defineProperty(expectedCycle, 'left', { enumerable: true, value: expectedCycle });

    assert.equal(compareDeepValues(actualCycle, expectedCycle).passed, true);
});

registerTest('compareDeepValues() reports small binary diffs', function () {
    const small = compareDeepValues(Uint8Array.from([ 1, 9, 3 ]), Uint8Array.from([ 1, 2, 3 ]));

    assert.deepStrictEqual(small.diff, {
        kind: 'array',
        operations: [
            {
                from: { kind: 'number', value: 2 },
                operation: 'replace',
                path: [ { kind: 'byte', offset: 1 } ],
                to: { kind: 'number', value: 9 }
            }
        ]
    });
});

registerTest('compareDeepValues() reports large binary summaries', function () {
    const largeActual = Uint8Array.from({ length: 101 }, function value(unusedValue, index) {
        assert.equal(unusedValue, undefined);

        return index === 50 ? 255 : 1;
    });
    const largeExpected = Uint8Array.from({ length: 101 }, function value() {
        return 1;
    });
    const large = compareDeepValues(largeActual, largeExpected);

    assert.ok(large.diff !== null);

    if (large.diff.kind !== 'binary') {
        assert.fail(`expected binary diff, received ${large.diff.kind}`);
    }

    assert.equal(large.diff.expectedSize, 101);
    assert.equal(large.diff.actualSize, 101);
    assert.deepStrictEqual(large.diff.ranges, [
        {
            actual: [ 255, 1, 1, 1, 1, 1, 1, 1 ],
            expected: [ 1, 1, 1, 1, 1, 1, 1, 1 ],
            offset: 50
        }
    ]);
});

registerTest('comparePartialValue() matches only the expected structural subset', function () {
    assert.equal(comparePartialValue([ 1, { ok: true }, 3 ], [ 1, { ok: true } ]).passed, true);
    assert.equal(comparePartialValue({ extra: true, id: 1 }, { id: 1 }).passed, true);
    assert.equal(
        comparePartialValue(
            new Map<unknown, unknown>([ [ { id: 1 }, { role: 'admin', user: 'ada' } ] ]),
            new Map<unknown, unknown>([
                [ { id: 1 }, { role: 'admin' } ]
            ])
        )
            .passed,
        true
    );
    assert.equal(
        comparePartialValue(
            new Set<unknown>([ { id: 1, name: 'Ada' } ]),
            new Set<unknown>([
                { id: 1 }
            ])
        )
            .passed,
        true
    );

    const missingProperty = comparePartialValue({ id: 1 }, { id: 1, name: 'Ada' });
    assert.deepStrictEqual(missingProperty.diff, {
        kind: 'object',
        operations: [
            {
                operation: 'missing-property',
                path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                value: { kind: 'string', truncation: null, value: 'Ada' }
            }
        ]
    });
});

registerTest('compareArrayContainsPartial() and compareMembersPartialDeepEqual() report missing members', function () {
    const contains = compareArrayContainsPartial([ { id: 1 } ], { id: 2 });
    const members = compareMembersPartialDeepEqual([ { id: 1 }, { id: 2 } ], [ { id: 2 }, { id: 3 } ]);

    assert.equal(contains.passed, false);
    assert.deepStrictEqual(contains.diff, {
        kind: 'array',
        operations: [
            {
                operation: 'missing-member',
                value: {
                    constructorName: 'Object',
                    entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 2 } } ],
                    kind: 'object',
                    truncation: null
                }
            }
        ]
    });
    assert.equal(members.passed, false);
    assert.deepStrictEqual(members.diff, {
        kind: 'array',
        operations: [
            {
                operation: 'missing-member',
                value: {
                    constructorName: 'Object',
                    entries: [ { key: { kind: 'string', value: 'id' }, value: { kind: 'number', value: 3 } } ],
                    kind: 'object',
                    truncation: null
                }
            }
        ]
    });
});
