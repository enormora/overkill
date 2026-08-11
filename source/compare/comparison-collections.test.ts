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
    compareArrayContainsPartial,
    compareDeepValues,
    compareMembersPartialDeepEqual,
    comparePartialValue
} from './comparison.ts';

const binaryDiff = defineNarrowingCompositeAssertion<Diff, Extract<Diff, { readonly kind: 'binary'; }>, readonly []>({
    name: 'binary diff',
    narrows(actual): actual is Extract<Diff, { readonly kind: 'binary'; }> {
        return actual.kind === 'binary';
    }
});

export const testSuite = createOverkillSuite({
    name: 'source/compare/comparison-collections.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'compareDeepValues() compares Set members order independently with deep values',
            metadata: {},
            body(scope: OverkillScope) {
                const actual = new Set<unknown>([ { id: 2 }, { id: 1 } ]);
                const expected = new Set<unknown>([ { id: 1 }, { id: 2 } ]);
                const changed = new Set<unknown>([ { id: 1 }, { id: 3 } ]);

                scope.assert.equal(compareDeepValues(actual, expected).passed, true);

                const result = compareDeepValues(actual, changed);
                const { diff } = result;
                scope.assert.equal(result.passed, false);
                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
                    kind: 'set',
                    operations: [
                        {
                            operation: 'remove',
                            path: [
                                {
                                    kind: 'set-value',
                                    value: {
                                        constructorName: 'Object',
                                        entries: [ {
                                            key: { kind: 'string', value: 'id' },
                                            value: { kind: 'number', value: 3 }
                                        } ],
                                        kind: 'object',
                                        truncation: null
                                    }
                                }
                            ],
                            value: {
                                constructorName: 'Object',
                                entries: [ {
                                    key: { kind: 'string', value: 'id' },
                                    value: { kind: 'number', value: 3 }
                                } ],
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
                                        entries: [ {
                                            key: { kind: 'string', value: 'id' },
                                            value: { kind: 'number', value: 2 }
                                        } ],
                                        kind: 'object',
                                        truncation: null
                                    }
                                }
                            ],
                            value: {
                                constructorName: 'Object',
                                entries: [ {
                                    key: { kind: 'string', value: 'id' },
                                    value: { kind: 'number', value: 2 }
                                } ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() compares Date, RegExp, and Error identity',
            metadata: {},
            body(scope: OverkillScope) {
                const firstError = Object.assign(new TypeError('bad value'), { code: 'A' }) as TypeError & {
                    readonly code: string;
                };
                const secondError = Object.assign(new TypeError('bad value'), { code: 'A' }) as TypeError & {
                    readonly code: string;
                };

                scope.assert.deepEqual(
                    [
                        compareDeepValues(new Date('2026-07-29T00:00:00.000Z'), new Date('2026-07-29T00:00:00.000Z'))
                            .passed,
                        compareDeepValues(new Date('2026-07-29T00:00:00.000Z'), new Date('2026-07-30T00:00:00.000Z'))
                            .passed,
                        compareDeepValues(/abc/giu, /abc/giu).passed,
                        compareDeepValues(/abc/giu, /abc/gi).passed,
                        compareDeepValues(firstError, secondError).passed
                    ],
                    [ true, false, true, false, true ]
                );
                const errorDiff = compareDeepValues(new Error('actual'), new Error('expected')).diff;
                scope.require.notNull(errorDiff);
                scope.assert.deepEqual(errorDiff, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() compares opaque built-ins by reference identity',
            metadata: {},
            body(scope: OverkillScope) {
                const promise = Promise.resolve();
                const weakMap = new WeakMap<Record<string, unknown>, unknown>();
                const weakSet = new WeakSet<Record<string, unknown>>();

                scope.assert.equal(compareDeepValues(promise, promise).passed, true);
                scope.assert.equal(compareDeepValues(Promise.resolve(), Promise.resolve()).passed, false);
                scope.assert.equal(compareDeepValues(weakMap, weakMap).passed, true);
                scope.assert.equal(
                    compareDeepValues(
                        new WeakMap<Record<string, unknown>, unknown>(),
                        new WeakMap<Record<string, unknown>, unknown>()
                    )
                        .passed,
                    false
                );
                scope.assert.equal(compareDeepValues(weakSet, weakSet).passed, true);
                scope.assert.equal(
                    compareDeepValues(new WeakSet<Record<string, unknown>>(), new WeakSet<Record<string, unknown>>())
                        .passed,
                    false
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() preserves repeated reference topology',
            metadata: {},
            body(scope: OverkillScope) {
                const actualShared = { left: null, right: null };
                const expectedShared = { left: null, right: null };
                const actual = { left: actualShared, right: actualShared };
                const expected = { left: expectedShared, right: expectedShared };
                const mismatchedExpected = {
                    left: { left: null, right: null },
                    right: { left: null, right: null }
                };
                scope.assert.equal(compareDeepValues(actual, expected).passed, true);
                scope.assert.equal(compareDeepValues(actual, mismatchedExpected).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() preserves cycle topology',
            metadata: {},
            body(scope: OverkillScope) {
                const actualCycle = {};
                const expectedCycle = {};
                Object.defineProperty(actualCycle, 'left', { enumerable: true, value: actualCycle });
                Object.defineProperty(expectedCycle, 'left', { enumerable: true, value: expectedCycle });

                scope.assert.equal(compareDeepValues(actualCycle, expectedCycle).passed, true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() reports small binary diffs',
            metadata: {},
            body(scope: OverkillScope) {
                const small = compareDeepValues(Uint8Array.from([ 1, 9, 3 ]), Uint8Array.from([ 1, 2, 3 ]));
                const { diff } = small;

                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() reports large binary summaries',
            metadata: {},
            body(scope: OverkillScope) {
                const largeActual = Uint8Array.from({ length: 101 }, function value(unusedValue, index) {
                    scope.assert.equal(unusedValue, undefined);

                    return index === 50 ? 255 : 1;
                });
                const largeExpected = Uint8Array.from({ length: 101 }, function value() {
                    return 1;
                });
                const large = compareDeepValues(largeActual, largeExpected);
                const { diff } = large;

                scope.require.notNull(diff);
                scope.require(binaryDiff, diff);

                scope.assert.equal(diff.expectedSize, 101);
                scope.assert.equal(diff.actualSize, 101);
                scope.assert.deepEqual(diff.ranges, [
                    {
                        actual: [ 255, 1, 1, 1, 1, 1, 1, 1 ],
                        expected: [ 1, 1, 1, 1, 1, 1, 1, 1 ],
                        offset: 50
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'comparePartialValue() matches only the expected structural subset',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(comparePartialValue([ 1, { ok: true }, 3 ], [ 1, { ok: true } ]).passed, true);
                scope.assert.equal(comparePartialValue({ extra: true, id: 1 }, { id: 1 }).passed, true);
                scope.assert.equal(
                    comparePartialValue(
                        new Map<unknown, unknown>([ [ { id: 1 }, { role: 'admin', user: 'ada' } ] ]),
                        new Map<unknown, unknown>([
                            [ { id: 1 }, { role: 'admin' } ]
                        ])
                    )
                        .passed,
                    true
                );
                scope.assert.equal(
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
                const missingPropertyDiff = missingProperty.diff;
                scope.require.notNull(missingPropertyDiff);
                scope.assert.deepEqual(missingPropertyDiff, {
                    kind: 'object',
                    operations: [
                        {
                            operation: 'missing-property',
                            path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                            value: { kind: 'string', truncation: null, value: 'Ada' }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareArrayContainsPartial() and compareMembersPartialDeepEqual() report missing members',
            metadata: {},
            body(scope: OverkillScope) {
                const contains = compareArrayContainsPartial([ { id: 1 } ], { id: 2 });
                const members = compareMembersPartialDeepEqual([ { id: 1 }, { id: 2 } ], [ { id: 2 }, { id: 3 } ]);
                const containsDiff = contains.diff;
                const membersDiff = members.diff;

                scope.assert.deepEqual(
                    {
                        containsPassed: contains.passed,
                        membersPassed: members.passed
                    },
                    {
                        containsPassed: false,
                        membersPassed: false
                    }
                );
                scope.require.notNull(containsDiff);
                scope.assert.deepEqual(containsDiff, {
                    kind: 'array',
                    operations: [
                        {
                            operation: 'missing-member',
                            value: {
                                constructorName: 'Object',
                                entries: [ {
                                    key: { kind: 'string', value: 'id' },
                                    value: { kind: 'number', value: 2 }
                                } ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ]
                });
                scope.require.notNull(membersDiff);
                scope.assert.deepEqual(membersDiff, {
                    kind: 'array',
                    operations: [
                        {
                            operation: 'missing-member',
                            value: {
                                constructorName: 'Object',
                                entries: [ {
                                    key: { kind: 'string', value: 'id' },
                                    value: { kind: 'number', value: 3 }
                                } ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
