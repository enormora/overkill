import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defaultPropertyPolicy } from '../config/property-policy.ts';
import { defineCodec } from './property-codec.ts';
import { capturePropertyInput, decodePropertyInput, migratePropertyInput } from './property-graph.ts';
import { createPropertyWork, propertyExhaustion } from './property-work.ts';

function consume(): void {
    return undefined;
}

async function fixture(name: string): Promise<unknown> {
    return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

const dateCodec = defineCodec<Date>({
    name: 'date',
    version: 3,
    previousDecoders: [ {
        version: 1,
        decode(payload) {
            if (typeof payload !== 'string') {
                throw new TypeError('Expected historical date string.');
            }
            return new Date(Number(payload));
        }
    } ],
    encode(value) {
        return value.getTime();
    },
    decode(payload) {
        if (typeof payload !== 'number') {
            throw new TypeError('Expected current date number.');
        }
        return new Date(payload);
    }
});

function nullRecord(): Record<string, unknown> {
    return { __proto__: null, x: 1 };
}

function sparseArray(): unknown[] {
    const values: unknown[] = [];
    values.length = 3;
    values[1] = undefined;
    return values;
}

function hasGraphLinks(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const views: unknown = Reflect.get(value, 'views');
    const buffer: unknown = Reflect.get(value, 'buffer');
    return Reflect.get(value, 'self') === value && Array.isArray(views) &&
        views.every(function sharesBuffer(view: unknown) {
            return ArrayBuffer.isView(view) && view.buffer === buffer;
        });
}

function expectedGraph(): Record<string, unknown> {
    const buffer = new ArrayBuffer(16);
    const bytes = new Uint8Array(buffer);
    bytes.set([ 1, 2, 3, 4 ]);
    const regex = /a/gu;
    regex.lastIndex = 2;
    const key = {};
    const expected = {
        numbers: [ Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 42n, undefined ],
        date: new Date(Number.NaN),
        record: nullRecord(),
        regex,
        buffer,
        views: [ new DataView(buffer, 4, 8), new Uint8Array(buffer, 1, 3) ],
        map: new Map<unknown, unknown>([ [ key, 'first' ], [ 'second', key ] ]),
        set: new Set<unknown>([ key, 'last' ]),
        sparse: sparseArray(),
        key
    };
    return Object.assign(expected, { self: expected });
}

export const testNode = suite('property decoder compatibility', [
    test('historical custom reads select exactly one decoder without encoding', async function (scope) {
        const input = await fixture('property-custom-v1');
        const before = JSON.stringify(input);
        const codec = defineCodec({
            ...dateCodec,
            encode(): never {
                throw new Error('Reads must not encode.');
            },
            decode(): never {
                throw new Error('Historical reads must not use the current decoder.');
            }
        });
        const first = decodePropertyInput(input, codec, consume);
        const second = decodePropertyInput(input, codec, consume);
        scope.assert.equal(first.getTime(), 42);
        scope.assert.false(first === second);
        scope.assert.equal(JSON.stringify(input), before);
        return scope.assert.collect();
    }),
    test(
        'explicit migration writes and validates the current codec without mutating the source',
        async function (scope) {
            const input = await fixture('property-custom-v1');
            const before = JSON.stringify(input);
            const migrated = migratePropertyInput(input, dateCodec, consume);
            scope.assert.deepEqual([ migrated.codec, migrated.format ], [
                { name: 'date', version: 3 },
                { name: 'overkill-property-graph', version: 1 }
            ]);
            scope.assert.equal(decodePropertyInput(migrated, dateCodec, consume).getTime(), 42);
            scope.assert.equal(JSON.stringify(input), before);
            const again = migratePropertyInput(migrated, dateCodec, consume);
            scope.assert.false(again === migrated);
            scope.assert.equal(decodePropertyInput(again, dateCodec, consume).getTime(), 42);
            return scope.assert.collect();
        }
    ),
    test('migration validates its output with the current decoder', async function (scope) {
        const input = await fixture('property-custom-v1');
        scope.assert.throws(function invalidMigration() {
            migratePropertyInput(input, {
                ...dateCodec,
                decode(): never {
                    throw new Error('Invalid current payload.');
                }
            }, consume);
        }, { name: 'PropertyCodecError' });
        return scope.assert.collect();
    }),
    test(
        'rejects unsupported identities and never falls back after a historical decoder fails',
        async function (scope) {
            const input = await fixture('property-custom-v1');
            for (
                const previousDecoders of [ [], [ {
                    version: 1,
                    decode(): never {
                        throw new Error('Historical decoder failed.');
                    }
                } ] ]
            ) {
                scope.assert.throws(function unavailableDecoder() {
                    decodePropertyInput(input, { ...dateCodec, previousDecoders }, consume);
                }, { name: 'PropertyCodecError' });
            }
            const encoded = capturePropertyInput('42', null, consume);
            for (
                const codec of [ { name: 'other', version: 1 }, { name: 'date', version: 2 }, {
                    name: 'date',
                    version: 4
                } ]
            ) {
                scope.assert.throws(function unsupportedIdentity() {
                    decodePropertyInput({ ...encoded, codec }, dateCodec, consume);
                }, { name: 'PropertyCodecError' });
            }
            const asynchronous = {
                ...dateCodec,
                previousDecoders: [ { version: 1, decode: Promise.resolve.bind(Promise) } ]
            };
            scope.assert.throws(function asynchronousDecoder() {
                Reflect.apply(decodePropertyInput, undefined, [ input, asynchronous, consume ]);
            }, { name: 'PropertyCodecError' });
            return scope.assert.collect();
        }
    ),
    test('migration preserves cancellation and work exhaustion', async function (scope) {
        const input = await fixture('property-custom-v1');
        const work = createPropertyWork({ ...defaultPropertyPolicy, maxWork: 1 }, AbortSignal.timeout(60_000));
        try {
            migratePropertyInput(input, dateCodec, work.context.consumeWork);
            throw new Error('Migration must exhaust work.');
        } catch (error: unknown) {
            scope.assert.equal(propertyExhaustion(error), 'work-exhausted');
        }
        scope.assert.throws(function cancelledMigration() {
            migratePropertyInput(input, dateCodec, function abort() {
                throw new DOMException('Cancelled', 'AbortError');
            });
        }, { name: 'AbortError' });
        return scope.assert.collect();
    }),
    test('fixed transport fixture preserves graph state independently of the writer', async function (scope) {
        const input = await fixture('property-graph-state-v1');
        const before = JSON.stringify(input);
        const value = decodePropertyInput(input, null, consume);
        const graph = expectedGraph();
        scope.assert.true(isDeepStrictEqual(value, graph));
        scope.assert.true(hasGraphLinks(value));
        const migrated = migratePropertyInput(input, null, consume);
        scope.assert.true(isDeepStrictEqual(decodePropertyInput(migrated, null, consume), graph));
        scope.assert.equal(JSON.stringify(input), before);
        return scope.assert.collect();
    })
]);
