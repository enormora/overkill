import { defineNarrowingCompositeAssertion } from '@overkill-dev/assert';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Diff } from '../diff/diff-shape.ts';
import {
    compareDeepValues,
    compareEqualValues,
    compareStringEquality
} from './comparison.ts';
import { failedResult } from './comparison-result.ts';

const mapDiff = defineNarrowingCompositeAssertion<Diff, Extract<Diff, { readonly kind: 'map'; }>, readonly []>({
    name: 'map diff',
    narrows(actual): actual is Extract<Diff, { readonly kind: 'map'; }> {
        return actual.kind === 'map';
    }
});

export const testSuite = createOverkillSuite({
    name: 'source/compare/comparison.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'compareEqualValues() uses Object.is primitive semantics',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(compareEqualValues(Number.NaN, Number.NaN).passed, true);
                scope.assert.equal(compareEqualValues(-0, 0).passed, false);
                scope.assert.equal(compareEqualValues(42, 42n).passed, false);

                const symbol = Symbol('same');
                scope.assert.equal(compareEqualValues(symbol, symbol).passed, true);
                scope.assert.equal(compareEqualValues(Symbol('same'), Symbol('same')).passed, false);

                const functionValue = function namedFunction(): number {
                    return 1;
                };
                scope.assert.equal(compareEqualValues(functionValue, functionValue).passed, true);
                scope.assert.equal(
                    compareEqualValues(function namedFunction() {
                        return 1;
                    }, function namedFunction() {
                        return 1;
                    })
                        .passed,
                    false
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareStringEquality() emits bounded string hunks for string equality failures only',
            metadata: {},
            body(scope: OverkillScope) {
                const result = compareStringEquality('first\nactual\nlast', 'first\nexpected\nlast');
                const { diff } = result;

                scope.assert.equal(result.passed, false);
                scope.assert.deepEqual(result.path, []);
                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
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
                scope.assert.equal(compareEqualValues('actual', 'expected').diff, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'failedResult() uses an empty path for structured diffs without operations',
            metadata: {},
            body(scope: OverkillScope) {
                const result = failedResult([ 1 ], [ 2 ], { kind: 'array', operations: [] });

                scope.assert.deepEqual(result.path, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() distinguishes numeric and primitive edge cases',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(compareDeepValues(Number.NaN, Number.NaN).passed, true);
                scope.assert.equal(compareDeepValues(-0, 0).passed, false);
                const { diff } = compareDeepValues(-0, 0);
                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
                    actual: { kind: 'number', value: '-0' },
                    expected: { kind: 'number', value: 0 },
                    kind: 'value'
                });
                scope.assert.equal(compareDeepValues(42, 42n).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() compares arrays including holes, undefined, length, and paths',
            metadata: {},
            body(scope: OverkillScope) {
                const hole: unknown[] = [];
                hole.length = 1;

                const holeResult = compareDeepValues([ undefined ], hole);
                const nestedResult = compareDeepValues([ { count: 1 } ], [ { count: 2 } ]);
                const { diff: lengthDiff } = compareDeepValues([ 1, 2 ], [ 1 ]);

                scope.assert.deepEqual(
                    {
                        holePassed: holeResult.passed,
                        holePath: holeResult.path,
                        nestedPath: nestedResult.path
                    },
                    {
                        holePassed: false,
                        holePath: [ { index: 0, kind: 'index' } ],
                        nestedPath: [ { index: 0, kind: 'index' } ]
                    }
                );
                scope.require.notNull(lengthDiff);
                scope.assert.deepEqual(lengthDiff, {
                    kind: 'array',
                    operations: [
                        {
                            operation: 'add',
                            path: [ { index: 1, kind: 'index' } ],
                            value: { kind: 'number', value: 2 }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() compares enumerable string and symbol data without invoking accessors',
            metadata: {},
            body(scope: OverkillScope) {
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

                const { diff, passed, path } = compareDeepValues(actual, expected);

                scope.assert.deepEqual(
                    {
                        passed,
                        path
                    },
                    {
                        passed: false,
                        path: [ { key: { kind: 'symbol', value: 'Symbol(id)' }, kind: 'property' } ]
                    }
                );
                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() ignores non-enumerable properties',
            metadata: {},
            body(scope: OverkillScope) {
                const actual = {};
                const expected = {};
                Object.defineProperty(actual, 'hidden', { enumerable: false, value: 1 });
                Object.defineProperty(expected, 'hidden', { enumerable: false, value: 2 });

                scope.assert.equal(compareDeepValues(actual, expected).passed, true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() requires matching class prototypes before enumerable data comparison',
            metadata: {},
            body(scope: OverkillScope) {
                const actual = { id: 1 };
                const expected = { id: 1 };
                Object.setPrototypeOf(actual, { constructor: { name: 'Actual' } });
                Object.setPrototypeOf(expected, { constructor: { name: 'Expected' } });

                const result = compareDeepValues(actual, expected);
                const { diff } = result;

                scope.assert.equal(result.passed, false);
                scope.require.notNull(diff);
                scope.assert.equal(diff.kind, 'value');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() compares Map entries order independently with deep keys and values',
            metadata: {},
            body(scope: OverkillScope) {
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
                scope.assert.equal(compareDeepValues(actual, expected).passed, true);

                const changedResult = compareDeepValues(actual, changed);
                scope.assert.equal(changedResult.passed, false);
                scope.assert.deepEqual(changedResult.path, [
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() reports missing Map entries by key',
            metadata: {},
            body(scope: OverkillScope) {
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

                scope.assert.equal(missingResult.passed, false);
                scope.require.notNull(missingDiff);
                scope.require(mapDiff, missingDiff);

                scope.assert.equal(missingDiff.operations[0]?.operation, 'remove');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
