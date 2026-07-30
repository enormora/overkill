import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { serializeValue, serializeValueWithBudget } from './serialized-value.ts';

registerTest('serializeValue() handles invalid dates and anonymous functions', function () {
    const anonymousInstance = { value: 1 };

    Object.setPrototypeOf(anonymousInstance, { constructor: { name: '' } });

    assert.deepStrictEqual(serializeValue(new Date(Number.NaN)), { kind: 'date', value: null });
    assert.deepStrictEqual(
        serializeValue(function () {
            return 1;
        }),
        { id: 1, kind: 'function', name: null }
    );
    assert.equal(serializeValue(anonymousInstance).kind, 'object');
    assert.deepStrictEqual(serializeValue(Object.create(null)), {
        constructorName: 'Object',
        entries: [],
        kind: 'object',
        truncation: null
    });
});

registerTest('serializeValue() reports unavailable constructor names when prototypes cannot be read', function () {
    const proxy = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('prototype unavailable');
        }
    });

    assert.deepStrictEqual(serializeValue(proxy), {
        constructorName: 'Unavailable',
        entries: [],
        kind: 'object',
        truncation: null
    });
});

registerTest('serializeValue() reports descriptor failures', function () {
    const proxy = new Proxy({}, {
        ownKeys() {
            throw new Error('keys unavailable');
        }
    });

    assert.deepStrictEqual(serializeValue(proxy), {
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
});

registerTest('serializeValueWithBudget() truncates maps, sets, binary bytes, and arrays independently', function () {
    const budget = {
        arrayEntries: 1,
        depth: 8,
        objectEntries: 1,
        operandBytes: 10_000,
        stringBytes: 100,
        visitedNodes: 100
    };

    assert.deepStrictEqual(
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
    assert.deepStrictEqual(serializeValueWithBudget(new Set<unknown>([ 'one', 'two' ]), budget), {
        kind: 'set',
        size: 2,
        truncation: { budget: 1, reason: 'object-entries' },
        values: [ { kind: 'string', truncation: null, value: 'one' } ]
    });
    assert.deepStrictEqual(serializeValueWithBudget(Uint8Array.from([ 1, 2 ]), budget), {
        byteLength: 2,
        bytes: [ 1 ],
        constructorName: 'Uint8Array',
        kind: 'typed-array',
        length: 2,
        truncation: { budget: 1, reason: 'array-entries' }
    });
    assert.deepStrictEqual(serializeValueWithBudget([ 1 ], budget), {
        entries: [ { key: { kind: 'string', value: '0' }, value: { kind: 'number', value: 1 } } ],
        kind: 'array',
        length: 1,
        truncation: null
    });
});

registerTest('serializeValue() reports Map and Set impostors as unavailable', function () {
    const mapImpostor = Object.create(Map.prototype) as Readonly<Record<string, unknown>>;
    const setImpostor = Object.create(Set.prototype) as Readonly<Record<string, unknown>>;

    assert.equal(serializeValue(mapImpostor).kind, 'unavailable');
    assert.equal(serializeValue(setImpostor).kind, 'unavailable');
});
