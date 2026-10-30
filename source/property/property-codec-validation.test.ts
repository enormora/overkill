import { suite, test } from '../packages/test/test.entry-point.ts';
import { defaultPropertyPolicy } from '../config/property-policy.ts';
import { capturePropertyInput, decodePropertyInput } from './property-graph.ts';
import { defineCodec, type PropertyInputCodec } from './property-codec.ts';
import { createPropertyWork, propertyExhaustion } from './property-work.ts';

function consume(): void {
    return undefined;
}

function failureOf(operation: () => unknown): unknown {
    try {
        operation();
        return null;
    } catch (error: unknown) {
        return error;
    }
}

function numericCodec(): PropertyInputCodec<number> {
    return { name: 'number', version: 2, previousDecoders: [], encode: Number, decode: Number };
}

export const testNode = suite('property codec validation', [
    test('rejects hidden native state after prototype replacement', function (scope) {
        for (
            const value of [
                new Map([ [ 'key', 1 ] ]),
                new Set([ 1 ]),
                new WeakMap(),
                Promise.resolve(1),
                new URL('https://example.com')
            ]
        ) {
            Object.setPrototypeOf(value, Object.prototype);
            scope.assert.throws(function alteredNativeValue() {
                capturePropertyInput(value, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    }),
    test('snapshots historical decoder metadata without invoking callbacks', function (scope) {
        let calls = 0;
        const definition = {
            ...numericCodec(),
            previousDecoders: [ {
                version: 1,
                decode(value: unknown) {
                    calls += 1;
                    return Number(value);
                }
            } ]
        };
        const codec = defineCodec(definition);
        definition.previousDecoders.length = 0;
        scope.assert.equal(codec.previousDecoders.length, 1);
        scope.assert.true(Object.isFrozen(codec));
        scope.assert.true(Object.isFrozen(codec.previousDecoders));
        scope.assert.true(Object.isFrozen(codec.previousDecoders[0]));
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    test('rejects malformed codec metadata and callbacks', function (scope) {
        for (
            const change of [
                { name: '' },
                { name: 'overkill-standard-input' },
                { version: 0 },
                { version: Number.MAX_VALUE },
                { encode: null },
                { decode: null },
                { previousDecoders: null },
                { previousDecoders: [ { version: 1, decode: null } ] }
            ]
        ) {
            scope.assert.throws(function invalidDefinition() {
                Reflect.apply(defineCodec, undefined, [ { ...numericCodec(), ...change } ]);
            }, { name: 'ZodError' });
        }
        return scope.assert.collect();
    }),
    test('rejects conflicting historical decoder versions', function (scope) {
        for (
            const previousDecoders of [ [ { version: 2, decode: Number } ], [ { version: 1, decode: Number }, {
                version: 1,
                decode: Number
            } ] ]
        ) {
            scope.assert.throws(function conflictingVersions() {
                defineCodec({ ...numericCodec(), previousDecoders });
            }, { name: 'TypeError' });
        }
        return scope.assert.collect();
    }),
    test('rejects proxies before invoking traps and rejects extra built-in state', function (scope) {
        let traps = 0;
        const proxy = new Proxy({}, {
            getPrototypeOf() {
                traps += 1;
                return Object.prototype;
            }
        });
        for (
            const value of [
                proxy,
                Object.assign(new Date(42), { extra: 1 }),
                { [Symbol('state')]: 1 },
                function unsupportedFunction() {
                    return 1;
                }
            ]
        ) {
            scope.assert.throws(function unsupportedState() {
                capturePropertyInput(value, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        scope.assert.equal(traps, 0);
        return scope.assert.collect();
    }),
    test('round trips a large sparse graph without filling holes', function (scope) {
        const value: unknown[] = [];
        value.length = 1_000_000;
        value[100] = value;
        const restored = decodePropertyInput(capturePropertyInput(value, null, consume), null, consume);
        if (!Array.isArray(restored)) {
            throw new TypeError('Expected an array.');
        }
        scope.assert.equal(restored.length, value.length);
        scope.assert.true(restored[100] === restored);
        scope.assert.false(Object.hasOwn(restored, 0));
        return scope.assert.collect();
    }),
    test('rejects non-table payloads and incompatible format or codec identities', function (scope) {
        const encoded = capturePropertyInput(null, null, consume);
        for (
            const changed of [
                { ...encoded, payload: null },
                { ...encoded, format: { name: 'unknown', version: 1 } },
                { ...encoded, format: { ...encoded.format, version: 2 } },
                { ...encoded, codec: { name: 'unknown', version: 1 } },
                { ...encoded, codec: { ...encoded.codec, version: 2 } }
            ]
        ) {
            scope.assert.throws(function incompatibleInput() {
                decodePropertyInput(changed, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    }),
    test('validates references, sparse bounds, escaped keys and native state before hydration', function (scope) {
        const encoded = capturePropertyInput(null, null, consume);
        for (
            const payload of [
                [ { unsafe: 0 } ],
                [ [ 'null', '$key' ] ],
                [ [ -7, 3, 0 ] ],
                [ [ -7, 3, 3, 0 ] ],
                [ [ -7, -1 ] ],
                [ [ 'Object', 0 ] ],
                [ [ 'DataView', 0, -1, 8 ] ],
                [ [ 'RegExp', 'a', 'invalid' ] ],
                [ [ 'ArrayBuffer', 'invalid bytes' ] ],
                [ [ 'Set', -2 ] ]
            ]
        ) {
            scope.assert.throws(function invalidGraph() {
                decodePropertyInput({ ...encoded, payload }, null, consume);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    }),
    test('propagates work exhaustion and cancellation without wrapping them as codec failures', function (scope) {
        const signal = AbortSignal.abort();
        const controller = new AbortController();
        const work = createPropertyWork({ ...defaultPropertyPolicy, maxWork: 1 }, controller.signal);
        const encoded = capturePropertyInput({ value: 1 }, null, consume);
        scope.assert.equal(
            propertyExhaustion(failureOf(function exhaustedCapture() {
                return capturePropertyInput({ value: 1 }, null, work.context.consumeWork);
            })),
            'work-exhausted'
        );
        scope.assert.equal(
            propertyExhaustion(failureOf(function exhaustedDecode() {
                return decodePropertyInput(encoded, null, work.context.consumeWork);
            })),
            'work-exhausted'
        );
        scope.assert.throws(function cancelledCapture() {
            capturePropertyInput(null, null, function checkCancellation() {
                signal.throwIfAborted();
            });
        }, { name: 'AbortError' });
        scope.assert.throws(function cancelledDecode() {
            decodePropertyInput(encoded, null, function checkCancellation() {
                signal.throwIfAborted();
            });
        }, { name: 'AbortError' });
        return scope.assert.collect();
    }),
    test('rejects asynchronous encoders and decoders at the runtime boundary', function (scope) {
        const definition = numericCodec();
        const asynchronousValue = Promise.resolve.bind(Promise);
        for (const change of [ { encode: asynchronousValue }, { decode: asynchronousValue } ]) {
            scope.assert.throws(function asynchronousCodec() {
                Reflect.apply(capturePropertyInput, undefined, [ 1, { ...definition, ...change }, consume ]);
            }, { name: 'PropertyCodecError' });
        }
        return scope.assert.collect();
    })
]);
