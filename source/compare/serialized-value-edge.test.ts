import { suite, test } from '@overkill-dev/test';

import { serializeValue, serializeValueWithBudget } from './serialized-value.ts';

function inaccessibleProperties(cause: unknown): Record<string, unknown> {
    return new Proxy({}, {
        ownKeys() {
            throw cause;
        }
    });
}

export const testNode = suite('Serialized value edge cases', [
    test(
        'retains diagnostics when property introspection throws a non-Error value',
        function (scope) {
            scope.assert.deepEqual(serializeValue(inaccessibleProperties(null)), {
                constructorName: 'Object',
                entries: [ {
                    key: { kind: 'string', value: '<introspection>' },
                    value: { kind: 'unavailable', reason: 'object introspection failed' }
                } ],
                kind: 'object',
                truncation: null
            });
            return scope.assert.collect();
        }
    ),
    test(
        'preserves repeated function references when function names are absent',
        function (scope) {
            const callable = function (): null {
                return null;
            };
            Reflect.deleteProperty(callable, 'name');
            Object.setPrototypeOf(callable, null);
            scope.assert.deepEqual(serializeValue([ callable, callable ]), {
                kind: 'array',
                length: 2,
                entries: [
                    { key: { kind: 'string', value: '0' }, value: { kind: 'function', id: 2, name: null } },
                    { key: { kind: 'string', value: '1' }, value: { kind: 'circular', reference: 2 } }
                ],
                truncation: null
            });
            return scope.assert.collect();
        }
    ),
    test('identifies instances of unnamed constructors', function (scope) {
        const unnamedConstructor = function (): null {
            return null;
        };
        Object.defineProperty(unnamedConstructor, 'name', { value: '' });
        scope.assert.deepEqual(serializeValue(Object.create({ constructor: unnamedConstructor })), {
            constructorName: '(anonymous)',
            entries: [],
            kind: 'object',
            truncation: null
        });
        return scope.assert.collect();
    }),
    test('handles invalid dates and anonymous functions', function (scope) {
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
    }),
    test(
        'reports unavailable constructor names when prototypes cannot be read',
        function (scope) {
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
    ),
    test('reports descriptor failures', function (scope) {
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
    }),
    test(
        'serializeValueWithBudget() truncates maps, sets, binary bytes, and arrays independently',
        function (scope) {
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
    ),
    test('reports Map and Set impostors as unavailable', function (scope) {
        const mapImpostor = Object.create(Map.prototype) as Readonly<Record<string, unknown>>;
        const setImpostor = Object.create(Set.prototype) as Readonly<Record<string, unknown>>;

        scope.assert.equal(serializeValue(mapImpostor).kind, 'unavailable');
        scope.assert.equal(serializeValue(setImpostor).kind, 'unavailable');

        return scope.assert.collect();
    })
]);
