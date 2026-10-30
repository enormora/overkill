import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { testNode as compatibility } from './property-compatibility.test.ts';
import { testNode as validation } from './property-codec-validation.test.ts';
import { testNode as execution } from './property-codec-execution.test.ts';
import { capturePropertyInput, decodePropertyInput } from './property-graph.ts';
import { defineCodec } from './property-codec.ts';

function consume(): void {
    return undefined;
}

function sparseArray(): unknown[] {
    const value: unknown[] = [];
    value.length = 3;
    return value;
}

type GraphFields = {
    readonly shared: unknown;
    readonly again: unknown;
    readonly buffer: unknown;
    readonly view: unknown;
    readonly map: unknown;
    readonly sparse: unknown;
};
function hasGraphFields(value: unknown): value is GraphFields {
    return typeof value === 'object' && value !== null &&
        [ 'shared', 'again', 'buffer', 'view', 'map', 'sparse' ].every(function own(key) {
            return Object.hasOwn(value, key);
        });
}

function cyclicGraph(): GraphFields {
    const shared = { number: -0 };
    const buffer = new ArrayBuffer(16);
    const value = {
        shared,
        again: shared,
        sparse: sparseArray(),
        buffer,
        view: new DataView(buffer, 4, 8),
        map: new Map<unknown, unknown>()
    };
    value.map.set(shared, value);
    return value;
}

function viewSharesBuffer(value: unknown, buffer: unknown): boolean {
    return value instanceof DataView && value.buffer === buffer && value.byteOffset === 4 && value.byteLength === 8;
}

function hasThreeHoles(value: unknown): boolean {
    return Array.isArray(value) && value.length === 3 && !Object.hasOwn(value, 0);
}

function expressionState(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const expression: unknown = Reflect.get(value, 'expression');
    return expression instanceof RegExp ? expression.lastIndex : null;
}

export const testNode = suite('property graph codecs', [
    validation,
    compatibility,
    test('round trips every supported standard value family', async function (scope) {
        const values: readonly unknown[] = [
            null,
            undefined,
            true,
            false,
            'text',
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            -0,
            42n,
            new Date(Number.NaN),
            new Date(42),
            Object.assign(Object.create(null), { value: 1 }),
            new Set([ 'first', 'second' ]),
            new Map([ [ 'first', 1 ], [ 'second', 2 ] ]),
            new Int8Array([ -1, 2 ]),
            new Uint8Array([ 1, 2 ]),
            new Uint8ClampedArray([ 1, 2 ]),
            new Int16Array([ -1, 2 ]),
            new Uint16Array([ 1, 2 ]),
            new Int32Array([ -1, 2 ]),
            new Uint32Array([ 1, 2 ]),
            new Float16Array([ 1.5, 2 ]),
            new Float32Array([ 1.5, 2 ]),
            new Float64Array([ 1.5, 2 ]),
            new BigInt64Array([ -1n, 2n ]),
            new BigUint64Array([ 1n, 2n ])
        ];
        const fixtures: unknown = JSON.parse(
            await readFile(new URL('./fixtures/property-values-v1.json', import.meta.url), 'utf8')
        );
        if (!Array.isArray(fixtures) || fixtures.length !== values.length) {
            throw new TypeError('Expected one fixture per standard value.');
        }
        for (const [ index, value ] of values.entries()) {
            scope.assert.true(isDeepStrictEqual(decodePropertyInput(fixtures[index], null, consume), value));
            const encoded = capturePropertyInput(value, null, consume);
            scope.assert.true(isDeepStrictEqual(decodePropertyInput(encoded, null, consume), value));
        }
        return scope.assert.collect();
    }),
    execution,
    test('rejects malformed references and unsupported native tags', function (scope) {
        const encoded = capturePropertyInput(null, null, consume);
        for (const payload of [ [ { $value: 99 } ], [ [ 'URL', 'https://example.com' ] ], [ [ 'Map', 0 ] ] ]) {
            scope.assert.throws(function malformedGraph() {
                decodePropertyInput({ ...encoded, payload }, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    }),
    test('rejects unsupported values and descriptors', function (scope) {
        for (
            const value of [
                Symbol('unsupported'),
                Buffer.from('bytes'),
                new WeakMap(),
                Object.freeze({ value: 1 }),
                new ArrayBuffer(8, { maxByteLength: 16 })
            ]
        ) {
            scope.assert.throws(function unsupportedInput() {
                capturePropertyInput(value, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    }),
    test('decodes the version one compatibility fixture', async function (scope) {
        const input: unknown = JSON.parse(
            await readFile(new URL('./fixtures/property-graph-v1.json', import.meta.url), 'utf8')
        );
        const value = decodePropertyInput(input, null, consume);
        scope.assert.equal(expressionState(value), 2);
        if (typeof value !== 'object' || value === null) {
            throw new TypeError('Expected a fixture graph.');
        }
        scope.assert.true(Reflect.get(value, 'self') === value);
        scope.assert.true(Reflect.get(value, 'shared') === Reflect.get(value, 'again'));
        return scope.assert.collect();
    }),
    test('preserves cycles, aliases, sparse arrays and binary backing stores', function (scope) {
        const value = cyclicGraph();
        const restored = decodePropertyInput(capturePropertyInput(value, null, consume), null, consume);
        scope.assert.true(typeof restored === 'object' && restored !== null);
        if (hasGraphFields(restored)) {
            scope.assert.true(restored.shared === restored.again);
            scope.assert.true(viewSharesBuffer(restored.view, restored.buffer));
            scope.assert.true(restored.map instanceof Map && restored.map.get(restored.shared) === restored);
            scope.assert.true(hasThreeHoles(restored.sparse));
        }
        return scope.assert.collect();
    }),
    test('rejects accessors without invoking them', function (scope) {
        let calls = 0;
        const value = Object.defineProperty({}, 'read', {
            get() {
                calls += 1;
                return 42;
            }
        });
        let rejected = false;
        try {
            capturePropertyInput(value, null, consume);
        } catch {
            rejected = true;
        }
        scope.assert.true(rejected);
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    test('preserves custom codec behavior and exercises the decoder', function (scope) {
        const codec = defineCodec<Date>({
            name: 'date',
            version: 1,
            previousDecoders: [],
            encode(value) {
                return value.getTime();
            },
            decode(value) {
                return new Date(Number(value));
            }
        });
        const input = capturePropertyInput(new Date(42), codec, consume);
        const restored = decodePropertyInput(input, codec, consume);
        scope.assert.true(restored instanceof Date && restored.getTime() === 42);
        return scope.assert.collect();
    }),
    test('preserves regex state and escaped record keys', function (scope) {
        const value = Object.defineProperty({ expression: /a/gu }, '__proto__', {
            value: 42,
            enumerable: true,
            configurable: true,
            writable: true
        });
        value.expression.lastIndex = 3;
        const restored = decodePropertyInput(capturePropertyInput(value, null, consume), null, consume);
        scope.assert.equal(expressionState(restored), 3);
        scope.assert.equal(Object.getOwnPropertyDescriptor(restored, '__proto__')?.value, 42);
        return scope.assert.collect();
    })
]);
