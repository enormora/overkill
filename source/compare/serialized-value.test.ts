import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { serializeValue, serializeValueWithBudget } from './serialized-value.ts';

registerTest('serializeValue() preserves primitive edge cases explicitly', function () {
    const symbol = Symbol.for('id');

    assert.deepStrictEqual(
        [
            serializeValue(undefined),
            serializeValue(null),
            serializeValue(true),
            serializeValue(false),
            serializeValue(Number.NaN),
            serializeValue(-0),
            serializeValue(0),
            serializeValue(Number.POSITIVE_INFINITY),
            serializeValue(Number.NEGATIVE_INFINITY),
            serializeValue(42n),
            serializeValue('value'),
            serializeValue(symbol)
        ],
        [
            { kind: 'undefined' },
            { kind: 'null' },
            { kind: 'boolean', value: true },
            { kind: 'boolean', value: false },
            { kind: 'number', value: 'NaN' },
            { kind: 'number', value: '-0' },
            { kind: 'number', value: 0 },
            { kind: 'number', value: 'Infinity' },
            { kind: 'number', value: '-Infinity' },
            { kind: 'bigint', value: '42' },
            { kind: 'string', truncation: null, value: 'value' },
            { kind: 'symbol', value: 'Symbol.for(id)' }
        ]
    );
});

registerTest('serializeValue() handles functions, arrays, holes, objects, symbols, and accessors', function () {
    const symbolKey = Symbol('id');
    const values: unknown[] = [ 'present' ];
    values.length = 2;
    const subject = {
        [symbolKey]: 1,
        get dangerous() {
            throw new Error('getter must not run');
        },
        nested: values,
        run() {
            return 'ignored';
        }
    };

    const serialized = serializeValue(subject);

    assert.deepStrictEqual(serialized, {
        constructorName: 'Object',
        entries: [
            {
                key: { kind: 'string', value: 'dangerous' },
                value: { kind: 'unavailable', reason: 'accessor property was not invoked' }
            },
            {
                key: { kind: 'string', value: 'nested' },
                value: {
                    entries: [
                        {
                            key: { kind: 'string', value: '0' },
                            value: { kind: 'string', truncation: null, value: 'present' }
                        },
                        { key: { kind: 'string', value: '1' }, value: { kind: 'unavailable', reason: 'array hole' } }
                    ],
                    kind: 'array',
                    length: 2,
                    truncation: null
                }
            },
            {
                key: { kind: 'string', value: 'run' },
                value: { id: 3, kind: 'function', name: 'run' }
            },
            {
                key: { kind: 'symbol', value: 'Symbol(id)' },
                value: { kind: 'number', value: 1 }
            }
        ],
        kind: 'object',
        truncation: null
    });
});

registerTest('serializeValue() handles maps and sets', function () {
    const mapValue = serializeValue(new Map<unknown, unknown>([ [ { id: 1 }, { name: 'Ada' } ] ]));
    const setValue = serializeValue(new Set<unknown>([ { id: 1 } ]));

    assert.equal(mapValue.kind, 'map');
    assert.equal(setValue.kind, 'set');
});

registerTest('serializeValue() handles errors, dates, and regexps', function () {
    const errorValue = serializeValue(new TypeError('bad value'));
    const dateValue = serializeValue(new Date('2026-07-29T00:00:00.000Z'));
    const regexpValue = serializeValue(/overkill/giu);

    assert.deepStrictEqual(errorValue, {
        entries: [],
        kind: 'error',
        message: 'bad value',
        name: 'TypeError',
        truncation: null
    });
    assert.deepStrictEqual(dateValue, { kind: 'date', value: '2026-07-29T00:00:00.000Z' });
    assert.deepStrictEqual(regexpValue, { flags: 'giu', kind: 'regexp', source: 'overkill' });
});

registerTest('serializeValue() handles opaque references', function () {
    const promiseValue = serializeValue(Promise.resolve());
    const weakMapValue = serializeValue(new WeakMap<Record<string, unknown>, unknown>());
    const weakSetValue = serializeValue(new WeakSet<Record<string, unknown>>());

    assert.deepStrictEqual([
        promiseValue,
        weakMapValue,
        weakSetValue
    ], [
        { kind: 'opaque', type: 'promise' },
        { kind: 'opaque', type: 'weak-map' },
        { kind: 'opaque', type: 'weak-set' }
    ]);
});

registerTest('serializeValue() handles binary value kinds', function () {
    const buffer = Buffer.from([ 1, 2, 3 ]);
    const arrayBuffer = Uint8Array.from([ 4, 5 ]).buffer;
    const view = new DataView(Uint8Array.from([ 6, 7, 8 ]).buffer, 1, 2);
    const typed = new Uint16Array([ 256, 1 ]);

    assert.deepStrictEqual(serializeValue(buffer), {
        byteLength: 3,
        bytes: [ 1, 2, 3 ],
        constructorName: 'Buffer',
        kind: 'typed-array',
        length: 3,
        truncation: null
    });
    assert.deepStrictEqual(serializeValue(arrayBuffer), {
        byteLength: 2,
        bytes: [ 4, 5 ],
        kind: 'array-buffer',
        truncation: null
    });
    assert.deepStrictEqual(serializeValue(view), {
        byteLength: 2,
        bytes: [ 7, 8 ],
        kind: 'data-view',
        truncation: null
    });
    assert.deepStrictEqual(serializeValue(typed), {
        byteLength: 4,
        bytes: [ 0, 1, 1, 0 ],
        constructorName: 'Uint16Array',
        kind: 'typed-array',
        length: 2,
        truncation: null
    });
});

registerTest('serializeValue() represents cycles and repeated references', function () {
    const node = {};
    Object.defineProperty(node, 'next', { enumerable: true, value: node });

    assert.deepStrictEqual(serializeValue(node), {
        constructorName: 'Object',
        entries: [
            {
                key: { kind: 'string', value: 'next' },
                value: { kind: 'circular', reference: 1 }
            }
        ],
        kind: 'object',
        truncation: null
    });
});

registerTest('serializeValueWithBudget() enforces every configured budget boundary', function () {
    const budget = {
        arrayEntries: 1,
        depth: 1,
        objectEntries: 1,
        operandBytes: 10_000,
        stringBytes: 3,
        visitedNodes: 2
    };

    assert.deepStrictEqual(serializeValueWithBudget('abcd', budget), {
        kind: 'string',
        truncation: { budget: 3, reason: 'string-bytes' },
        value: 'abc'
    });
    assert.deepStrictEqual(serializeValueWithBudget([ 1, 2 ], budget), {
        entries: [ { key: { kind: 'string', value: '0' }, value: { kind: 'number', value: 1 } } ],
        kind: 'array',
        length: 2,
        truncation: { budget: 1, reason: 'array-entries' }
    });
    assert.deepStrictEqual(serializeValueWithBudget({ a: 1, b: 2 }, budget), {
        constructorName: 'Object',
        entries: [ { key: { kind: 'string', value: 'a' }, value: { kind: 'number', value: 1 } } ],
        kind: 'object',
        truncation: { budget: 1, reason: 'object-entries' }
    });
    assert.deepStrictEqual(
        serializeValueWithBudget({ a: { b: { c: 1 } } }, {
            ...budget,
            visitedNodes: 10
        }),
        {
            constructorName: 'Object',
            entries: [
                {
                    key: { kind: 'string', value: 'a' },
                    value: {
                        constructorName: 'Object',
                        entries: [
                            {
                                key: { kind: 'string', value: 'b' },
                                value: { kind: 'unavailable', reason: 'depth budget reached: 1' }
                            }
                        ],
                        kind: 'object',
                        truncation: null
                    }
                }
            ],
            kind: 'object',
            truncation: null
        }
    );
    assert.equal(
        serializeValueWithBudget({ a: { b: { c: 1 } } }, {
            ...budget,
            visitedNodes: 1
        })
            .kind,
        'unavailable'
    );
    assert.equal(
        serializeValueWithBudget({ long: 'x'.repeat(500) }, {
            ...budget,
            operandBytes: 20
        })
            .kind,
        'unavailable'
    );
});

registerTest('serializeValue() catches unavailable proxy introspection', function () {
    const proxy = new Proxy({}, {
        ownKeys() {
            throw new Error('no keys');
        }
    });

    assert.deepStrictEqual(serializeValue(proxy), {
        constructorName: 'Object',
        entries: [
            {
                key: { kind: 'string', value: '<introspection>' },
                value: { kind: 'unavailable', reason: 'no keys' }
            }
        ],
        kind: 'object',
        truncation: null
    });
});
