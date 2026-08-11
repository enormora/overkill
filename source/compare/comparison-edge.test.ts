import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    compareArrayContainsPartial,
    compareDeepValues,
    compareMembersPartialDeepEqual,
    comparePartialValue,
    compareStringEquality
} from './comparison.ts';

export const testSuite = createOverkillSuite({
    name: 'source/compare/comparison-edge.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'compareStringEquality() returns no diff for equal strings',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(compareStringEquality('same', 'same'), {
                    actual: { kind: 'string', truncation: null, value: 'same' },
                    diff: null,
                    expected: { kind: 'string', truncation: null, value: 'same' },
                    passed: true,
                    path: []
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() rejects mismatched container kinds',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(compareDeepValues([ 1 ], { 0: 1 }).passed, false);
                scope.assert.equal(compareDeepValues(new Map(), new Set()).passed, false);
                scope.assert.equal(compareDeepValues(new Set(), new Map()).passed, false);
                scope.assert.equal(compareDeepValues(new Date(), {}).passed, false);
                scope.assert.equal(compareDeepValues(/a/u, {}).passed, false);
                scope.assert.equal(compareDeepValues(Promise.resolve(), {}).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() treats unavailable object introspection as a mismatch',
            metadata: {},
            body(scope: OverkillScope) {
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

                scope.assert.equal(compareDeepValues(ownKeysProxy, {}).passed, false);
                scope.assert.equal(compareDeepValues(prototypeProxy, {}).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() emits object remove and add operations',
            metadata: {},
            body(scope: OverkillScope) {
                const missing = compareDeepValues({ id: 1 }, { id: 1, name: 'Ada' });
                const extra = compareDeepValues({ id: 1, name: 'Ada' }, { id: 1 });
                const missingDiff = missing.diff;
                const extraDiff = extra.diff;

                scope.require.notNull(missingDiff);
                scope.assert.deepEqual(missingDiff, {
                    kind: 'object',
                    operations: [
                        {
                            operation: 'remove',
                            path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                            value: { kind: 'string', truncation: null, value: 'Ada' }
                        }
                    ]
                });
                scope.require.notNull(extraDiff);
                scope.assert.deepEqual(extraDiff, {
                    kind: 'object',
                    operations: [
                        {
                            operation: 'add',
                            path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                            value: { kind: 'string', truncation: null, value: 'Ada' }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() emits array removal for missing actual indexes',
            metadata: {},
            body(scope: OverkillScope) {
                const result = compareDeepValues([ 1 ], [ 1, 2 ]);
                const { diff } = result;

                scope.require.notNull(diff);
                scope.assert.deepEqual(diff, {
                    kind: 'array',
                    operations: [
                        {
                            operation: 'remove',
                            path: [ { index: 1, kind: 'index' } ],
                            value: { kind: 'number', value: 2 }
                        }
                    ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() handles ArrayBuffer and byte length mismatches',
            metadata: {},
            body(scope: OverkillScope) {
                const changed = compareDeepValues(Uint8Array.from([ 1 ]).buffer, Uint8Array.from([ 2 ]).buffer);
                const longer = compareDeepValues(Uint8Array.from([ 1, 2 ]), Uint8Array.from([ 1 ]));
                const changedDiff = changed.diff;
                const longerDiff = longer.diff;

                scope.require.notNull(changedDiff);
                scope.assert.equal(changedDiff.kind, 'array');
                scope.require.notNull(longerDiff);
                scope.assert.deepEqual(longerDiff, {
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'compareDeepValues() reports Error name and enumerable data differences',
            metadata: {},
            body(scope: OverkillScope) {
                const actual = new Error('same');
                const expected = new Error('same');
                const actualData = Object.assign(new Error('same'), { code: 'actual' }) as Error & {
                    readonly code: string;
                };
                const expectedData = Object.assign(new Error('same'), { code: 'expected' }) as Error & {
                    readonly code: string;
                };

                Object.defineProperty(actual, 'name', { value: 'TypeError' });

                const nameDiff = compareDeepValues(actual, expected).diff;
                scope.require.notNull(nameDiff);
                scope.assert.equal(nameDiff.kind, 'object');
                scope.assert.deepEqual(compareDeepValues(actualData, expectedData).path, [
                    { key: { kind: 'string', value: 'code' }, kind: 'property' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'comparePartialValue() handles primitive, array, built-in, and opaque failures',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(comparePartialValue(1, 2).passed, false);
                scope.assert.equal(comparePartialValue({}, [ 1 ]).passed, false);
                scope.assert.equal(comparePartialValue([ 1 ], [ 1, 2 ]).passed, false);
                scope.assert.equal(comparePartialValue(new Date('2026-07-29'), new Date('2026-07-29')).passed, true);
                scope.assert.equal(comparePartialValue(new Date('2026-07-29'), new Date('2026-07-30')).passed, false);
                scope.assert.equal(comparePartialValue(/a/gu, /a/gu).passed, true);
                scope.assert.equal(comparePartialValue(/a/g, /a/u).passed, false);
                scope.assert.equal(comparePartialValue(Promise.resolve(), Promise.resolve()).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'comparePartialValue() preserves repeated reference topology',
            metadata: {},
            body(scope: OverkillScope) {
                const shared = { value: 1 };
                const actual = { left: shared, right: shared };
                const expected = {
                    left: { value: 1 },
                    right: { value: 1 }
                };

                scope.assert.equal(comparePartialValue(actual, expected).passed, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'comparePartialValue() handles Map, Set, Error, and binary subsets',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    [
                        compareDeepValues(new Map([ [ 'id', 1 ] ]), new Map()).passed,
                        compareDeepValues(new Set([ 1 ]), new Set()).passed,
                        comparePartialValue({}, new Map()).passed,
                        comparePartialValue({}, new Set()).passed,
                        comparePartialValue(new Uint8Array([ 1 ]), new Uint8Array([ 1 ])).passed,
                        comparePartialValue(new Uint8Array([ 1 ]), new Uint8Array([ 2 ])).passed,
                        comparePartialValue(new Error('actual'), new Error('expected')).passed
                    ],
                    [ false, false, false, false, true, false, false ]
                );
                const mapDiff = comparePartialValue(new Map(), new Map([ [ 'id', 1 ] ])).diff;
                const setDiff = comparePartialValue(new Set(), new Set([ 1 ])).diff;
                scope.require.notNull(mapDiff);
                scope.assert.deepEqual(mapDiff, {
                    kind: 'map',
                    operations: [
                        {
                            key: { kind: 'string', truncation: null, value: 'id' },
                            operation: 'missing-entry',
                            value: { kind: 'number', value: 1 }
                        }
                    ]
                });
                scope.require.notNull(setDiff);
                scope.assert.deepEqual(setDiff, {
                    kind: 'set',
                    operations: [ { operation: 'missing-member', value: { kind: 'number', value: 1 } } ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'array membership comparisons report pass and invalid operand cases',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(compareArrayContainsPartial([ { id: 1 } ], { id: 1 }).passed, true);
                scope.assert.equal(compareArrayContainsPartial({ id: 1 }, { id: 1 }).passed, false);
                scope.assert.equal(compareMembersPartialDeepEqual([ { id: 1 } ], { id: 1 }).passed, false);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
