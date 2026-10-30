import { types } from 'node:util';
import { stringify, unflatten } from 'devalue';
import { z } from 'zod/v4';
import type { JsonValue } from 'type-fest';
import type { EncodedPropertyInput } from '../packages/engine/engine.entry-point.ts';
import { propertyExhaustion } from './property-work.ts';
import { defineCodec, type PropertyInputCodec } from './property-codec.ts';

const format = Object.freeze({ name: 'overkill-property-graph', version: 1 });
const standard = Object.freeze({ name: 'overkill-standard-input', version: 1 });
const identitySchema = z.strictObject({ name: z.string(), version: z.number().int().positive() });
const envelopeSchema = z.strictObject({ format: identitySchema, codec: identitySchema, payload: z.json() });

export class PropertyCodecError extends Error {
    public constructor(operation: string, options: ErrorOptions) {
        super(`Property input codec ${operation} failed.`, options);
        this.name = 'PropertyCodecError';
    }
}

type RegexState = { readonly expression: RegExp; readonly lastIndex: unknown; };

type GraphKind = 'array' | 'binary' | 'map' | 'record' | 'regex' | 'set' | 'value' | 'view';
const graphKinds = new Map<unknown, GraphKind>([
    [ Object.prototype, 'record' ],
    [ null, 'record' ],
    [ Array.prototype, 'array' ],
    [ RegExp.prototype, 'regex' ],
    [ Map.prototype, 'map' ],
    [ Set.prototype, 'set' ],
    [ Date.prototype, 'value' ],
    [ ArrayBuffer.prototype, 'binary' ],
    [ DataView.prototype, 'value' ],
    ...[
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Float16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array
    ]
        .map(function viewKind(viewConstructor): readonly [unknown, GraphKind] {
            return [ viewConstructor.prototype, 'view' ];
        })
]);
const maximumArrayLength = 4_294_967_295;

function graphKind(value: unknown): GraphKind {
    if (types.isProxy(value)) {
        throw new TypeError('Proxies require a custom codec.');
    }
    const kind = graphKinds.get(Object.getPrototypeOf(value));
    if (kind === undefined || !Object.isExtensible(value)) {
        throw new TypeError('Unsupported property input brand or object state.');
    }
    return kind;
}

function intrinsicField(kind: GraphKind, key: string): boolean {
    return kind === 'array' && key === 'length' || kind === 'regex' && key === 'lastIndex';
}

const mutableDataField = z.object({ writable: z.literal(true), value: z.unknown() });
const ordinaryDataField = mutableDataField.extend({ enumerable: z.literal(true), configurable: z.literal(true) });
function dataDescriptor(value: unknown, key: string, kind: GraphKind): Readonly<PropertyDescriptor> {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Unsupported property input descriptor.');
    }
    const schema = intrinsicField(kind, key) ? mutableDataField : ordinaryDataField;
    schema.parse(descriptor);
    return descriptor;
}

function arrayIndex(key: string): boolean {
    return /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < maximumArrayLength;
}

function fieldKind(kind: GraphKind, key: string): 'child' | 'intrinsic' {
    if (kind === 'record') {
        return 'child';
    }
    if (arrayIndex(key)) {
        if (kind === 'array') {
            return 'child';
        }
        if (kind === 'view') {
            return 'intrinsic';
        }
    }
    if (intrinsicField(kind, key)) {
        return 'intrinsic';
    }
    throw new TypeError('Unsupported extra property state.');
}

function binaryChildren(value: unknown): readonly unknown[] {
    if (ArrayBuffer.isView(value)) {
        return [ value.buffer ];
    }
    if (types.isArrayBuffer(value) && (value.resizable || value.detached)) {
        throw new TypeError('Resizable and detached buffers require a custom codec.');
    }
    return [];
}

function graphChildren(value: unknown): readonly unknown[] {
    if (types.isMap(value)) {
        const entries: Iterable<readonly [unknown, unknown]> = Map.prototype.entries.call(value);
        return Array.from(entries).flat();
    }
    if (types.isSet(value)) {
        const entries: Iterable<unknown> = Set.prototype.values.call(value);
        return Array.from(entries);
    }
    return binaryChildren(value);
}

function inspectFields(value: unknown, kind: GraphKind, inspect: (child: unknown) => void): void {
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Symbol properties require a custom codec.');
    }
    for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = dataDescriptor(value, key, kind);
        if (fieldKind(kind, key) === 'child') {
            inspect(descriptor.value);
        }
    }
}

function inspectGraph(root: unknown, consume: () => void): readonly RegexState[] {
    const seen = new Set<unknown>();
    const expressions: RegexState[] = [];
    function inspectObject(value: unknown, visit: (child: unknown) => void): void {
        if (seen.has(value)) {
            return;
        }
        const kind = graphKind(value);
        seen.add(value);
        inspectFields(value, kind, visit);
        if (types.isRegExp(value)) {
            const lastIndex: unknown = Object.getOwnPropertyDescriptor(value, 'lastIndex')?.value;
            expressions.push({ expression: value, lastIndex });
            visit(lastIndex);
        }
        graphChildren(value).forEach(visit);
    }
    function inspect(value: unknown): void {
        consume();
        if (typeof value === 'function' || typeof value === 'symbol') {
            throw new TypeError('Functions and symbols require a custom codec.');
        }
        if (typeof value === 'object' && value !== null) {
            inspectObject(value, inspect);
        }
    }
    inspect(root);
    return expressions;
}

function graphPayload(value: unknown, consume: () => void): JsonValue {
    const expressions = inspectGraph(value, consume);
    return z.json().parse(JSON.parse(stringify({ value, expressions }, {}, {
        operations: {
            isThenable() {
                return false;
            },
            shapeOf(record: Readonly<Record<string, unknown>>) {
                return {
                    kind: Object.getPrototypeOf(record) === null ? 'null-proto' : 'plain',
                    keys: Object.keys(record).map(function escapeKey(key) {
                        return `$${key}`;
                    })
                };
            },
            get(record: Readonly<Record<string, unknown>>, key: number | string) {
                const original = Array.isArray(record) ? key : String(key).slice(1);
                const result: unknown = Object.getOwnPropertyDescriptor(record, original)?.value;
                return result;
            }
        }
    })));
}

const holeReference = -2;
const sparseReference = -7;
const minimumScalarReference = -6;
const pairLength = 2;
function graphReference(maximum: number): z.ZodNumber {
    return z.number().int().min(minimumScalarReference).max(maximum - 1).refine(function notHole(value) {
        return value !== holeReference;
    });
}

function validatePairs(
    values: readonly JsonValue[],
    key: (value: JsonValue) => void,
    entry: (value: JsonValue) => void
): void {
    if (values.length % pairLength !== 0) {
        throw new TypeError('Invalid property graph pairs.');
    }
    for (let index = 0; index < values.length; index += pairLength) {
        key(z.json().parse(values[index]));
        entry(z.json().parse(values[index + 1]));
    }
}

function validateArray(node: readonly JsonValue[], reference: Readonly<z.ZodNumber>): void {
    if (node[0] === sparseReference) {
        const length = z.number().int().min(0).max(maximumArrayLength).parse(node[1]);
        const ordinal = z.number().int().min(0).max(length - 1);
        validatePairs(node.slice(pairLength), function index(value) {
            ordinal.parse(value);
        }, function entry(value) {
            reference.parse(value);
        });
        return;
    }
    z.array(z.union([ z.literal(holeReference), reference ])).parse(node);
}

function taggedSchemas(reference: Readonly<z.ZodNumber>): Readonly<Record<string, z.ZodType>> {
    const stringScalar = z.string();
    const key = z.string().startsWith('$');
    return {
        Date: z.tuple([ z.literal('Date'), stringScalar ]),
        BigInt: z.tuple([ z.literal('BigInt'), stringScalar.regex(/^-?\d+$/u) ]),
        ArrayBuffer: z.tuple([
            z.literal('ArrayBuffer'),
            stringScalar.regex(/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u)
        ]),
        RegExp: z.union([
            z.tuple([ z.literal('RegExp'), stringScalar ]),
            z.tuple([ z.literal('RegExp'), stringScalar, stringScalar ])
        ]),
        Set: z.tuple([ z.literal('Set') ]).rest(reference),
        Map: z.tuple([ z.literal('Map') ]).rest(reference),
        null: z.tuple([ z.literal('null') ]).rest(z.union([ key, reference ]))
    };
}

function validateCollectionPairs(tag: string, values: readonly JsonValue[], reference: Readonly<z.ZodNumber>): void {
    if (tag === 'Map') {
        validatePairs(values, function key(value) {
            reference.parse(value);
        }, function entry(value) {
            reference.parse(value);
        });
    } else if (tag === 'null') {
        validatePairs(values, function key(value) {
            z.string().startsWith('$').parse(value);
        }, function entry(value) {
            reference.parse(value);
        });
    }
}

function validateTaggedNode(node: readonly JsonValue[], reference: Readonly<z.ZodNumber>): void {
    const stringScalar = z.string();
    const bound = z.number().int().nonnegative();
    const tag = z.string().parse(node[0]);
    const schema = taggedSchemas(reference)[tag];
    if (schema !== undefined) {
        schema.parse(node);
        validateCollectionPairs(tag, node.slice(1), reference);
        return;
    }
    z
        .string()
        .regex(
            /^(?:(?:Int8|Uint8|Uint8Clamped|Int16|Uint16|Float16|Int32|Uint32|Float32|Float64|BigInt64|BigUint64)Array|DataView)$/u
        )
        .parse(tag);
    z.union([ z.tuple([ stringScalar, reference ]), z.tuple([ stringScalar, reference, bound, bound ]) ]).parse(node);
}

function validateNode(node: JsonValue, reference: Readonly<z.ZodNumber>): void {
    if (node === null || typeof node !== 'object') {
        return;
    }
    if (!Array.isArray(node)) {
        z.record(z.string().startsWith('$'), reference).parse(node);
        return;
    }
    if (typeof node[0] === 'string') {
        validateTaggedNode(node, reference);
    } else {
        validateArray(node, reference);
    }
}

function validateTable(table: readonly JsonValue[]): void {
    const reference = graphReference(table.length);
    for (const node of table) {
        validateNode(node, reference);
    }
}

function restoreGraph(payload: JsonValue, consume: () => void): unknown {
    if (!Array.isArray(payload)) {
        throw new TypeError('Invalid property graph table.');
    }
    validateTable(payload);
    const document: unknown = unflatten(payload, {}, {
        operations: {
            box() {
                throw new TypeError('Unsupported boxed value.');
            },
            fromStringValue() {
                throw new TypeError('Unsupported native value.');
            },
            set(target: Readonly<Record<string, unknown>>, key: number | string, value: unknown) {
                if (!Array.isArray(target) && !String(key).startsWith('$')) {
                    throw new TypeError('Invalid escaped property key.');
                }
                const original = Array.isArray(target) ? key : String(key).slice(1);
                Object.defineProperty(target, original, {
                    value,
                    writable: true,
                    configurable: true,
                    enumerable: true
                });
            }
        }
    });
    const shape = z
        .object({
            value: z.unknown(),
            expressions: z.array(z.object({
                expression: z.instanceof(RegExp),
                lastIndex: z.unknown()
            }))
        })
        .parse(document);
    for (const state of shape.expressions) {
        Object.defineProperty(state.expression, 'lastIndex', { value: state.lastIndex });
    }
    inspectGraph(shape.value, consume);
    return shape.value;
}

function codecOperation<Value>(operation: string, execute: () => Value): Value {
    try {
        return execute();
    } catch (error: unknown) {
        if (propertyExhaustion(error) !== null || error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        throw new PropertyCodecError(operation, { cause: error });
    }
}

type CodecIdentity = { readonly name: string; readonly version: number; };
function matchesIdentity(actual: CodecIdentity, expected: CodecIdentity): boolean {
    return actual.name === expected.name && actual.version === expected.version;
}

export function decodePropertyInput<Value>(
    input: unknown,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): unknown {
    return codecOperation('decode', function decodeCurrentInput() {
        const envelope = envelopeSchema.parse(input);
        const expected = codec === null ? standard : defineCodec(codec);
        if (!matchesIdentity(envelope.format, format) || !matchesIdentity(envelope.codec, expected)) {
            throw new TypeError('Unsupported property input format or codec version.');
        }
        const payload = restoreGraph(envelope.payload, consume);
        const decoded = codec === null ? payload : codec.decode(payload);
        if (types.isPromise(decoded)) {
            throw new TypeError('Property input codecs must be synchronous.');
        }
        return decoded;
    });
}

export function capturePropertyInput<Value>(
    value: Value,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): EncodedPropertyInput {
    return codecOperation('capture', function captureCurrentInput() {
        const selected = codec === null ? null : defineCodec(codec);
        const encoded = {
            format,
            codec: selected === null ? standard : { name: selected.name, version: selected.version },
            payload: graphPayload(selected === null ? value : selected.encode(value), consume)
        };
        decodePropertyInput(encoded, selected, consume);
        return encoded;
    });
}
