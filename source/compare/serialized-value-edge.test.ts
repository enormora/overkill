import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { serializeValue, serializeValueWithBudget } from './serialized-value.ts';

export const testSuite = createOverkillSuite({
    name: 'source/compare/serialized-value-edge.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'serializeValue() handles invalid dates and anonymous functions',
            metadata: {},
            body(scope: OverkillScope) {
                const anonymousInstance = { value: 1 };

                Object.setPrototypeOf(anonymousInstance, { constructor: { name: '' } });

                scope.assert.deepEqual(serializeValue(new Date(Number.NaN)), { kind: 'date', value: null });
                scope.assert.deepEqual(
                    serializeValue(function () {
                        return 1;
                    }),
                    { id: 1, kind: 'function', name: null }
                );
                scope.assert.equal(serializeValue(anonymousInstance).kind, 'object');
                scope.assert.deepEqual(serializeValue(Object.create(null)), {
                    constructorName: 'Object',
                    entries: [],
                    kind: 'object',
                    truncation: null
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'serializeValue() reports unavailable constructor names when prototypes cannot be read',
            metadata: {},
            body(scope: OverkillScope) {
                const proxy = new Proxy({}, {
                    getPrototypeOf() {
                        throw new Error('prototype unavailable');
                    }
                });

                scope.assert.deepEqual(serializeValue(proxy), {
                    constructorName: 'Unavailable',
                    entries: [],
                    kind: 'object',
                    truncation: null
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'serializeValue() reports descriptor failures',
            metadata: {},
            body(scope: OverkillScope) {
                const proxy = new Proxy({}, {
                    ownKeys() {
                        throw new Error('keys unavailable');
                    }
                });

                scope.assert.deepEqual(serializeValue(proxy), {
                    constructorName: 'Object',
                    entries: [
                        {
                            key: { kind: 'string', value: '<introspection>' },
                            value: { kind: 'unavailable', reason: 'keys unavailable' }
                        }
                    ],
                    kind: 'object',
                    truncation: null
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'serializeValueWithBudget() truncates maps, sets, binary bytes, and arrays independently',
            metadata: {},
            body(scope: OverkillScope) {
                const budget = {
                    arrayEntries: 1,
                    depth: 8,
                    objectEntries: 1,
                    operandBytes: 10_000,
                    stringBytes: 100,
                    visitedNodes: 100
                };

                scope.assert.deepEqual(
                    serializeValueWithBudget(
                        new Map<unknown, unknown>([
                            [ 'one', 1 ],
                            [ 'two', 2 ]
                        ]),
                        budget
                    ),
                    {
                        entries: [
                            {
                                key: { kind: 'string', truncation: null, value: 'one' },
                                value: { kind: 'number', value: 1 }
                            }
                        ],
                        kind: 'map',
                        size: 2,
                        truncation: { budget: 1, reason: 'object-entries' }
                    }
                );
                scope.assert.deepEqual(serializeValueWithBudget(new Set<unknown>([ 'one', 'two' ]), budget), {
                    kind: 'set',
                    size: 2,
                    truncation: { budget: 1, reason: 'object-entries' },
                    values: [ { kind: 'string', truncation: null, value: 'one' } ]
                });
                scope.assert.deepEqual(serializeValueWithBudget(Uint8Array.from([ 1, 2 ]), budget), {
                    byteLength: 2,
                    bytes: [ 1 ],
                    constructorName: 'Uint8Array',
                    kind: 'typed-array',
                    length: 2,
                    truncation: { budget: 1, reason: 'array-entries' }
                });
                scope.assert.deepEqual(serializeValueWithBudget([ 1 ], budget), {
                    entries: [ { key: { kind: 'string', value: '0' }, value: { kind: 'number', value: 1 } } ],
                    kind: 'array',
                    length: 1,
                    truncation: null
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'serializeValue() reports Map and Set impostors as unavailable',
            metadata: {},
            body(scope: OverkillScope) {
                const mapImpostor = Object.create(Map.prototype) as Readonly<Record<string, unknown>>;
                const setImpostor = Object.create(Set.prototype) as Readonly<Record<string, unknown>>;

                scope.assert.equal(serializeValue(mapImpostor).kind, 'unavailable');
                scope.assert.equal(serializeValue(setImpostor).kind, 'unavailable');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
