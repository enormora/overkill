import { types } from 'node:util';
import { stringify, unflatten } from 'devalue';
import { z } from 'zod/v4';
import type { JsonValue } from 'type-fest';

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
    if (
        kind === 'record' && Object.values(types).some(function nativeState(isNative) {
            return isNative(value);
        })
    ) {
        throw new TypeError('Native values with altered prototypes require a custom codec.');
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

export function encodeGraph(value: unknown, consume: () => void): JsonValue {
    const expressions = inspectGraph(value, consume);
    const document = { value, expressions };
    structuredClone(document);
    return z.json().parse(JSON.parse(stringify(document, {}, {
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

export function decodeGraph(payload: JsonValue, consume: () => void): unknown {
    if (!Array.isArray(payload)) {
        throw new TypeError('Invalid property graph table.');
    }
    validateTable(payload);
    const document: unknown = unflatten(payload, {}, {
        operations: {
            set(target: Readonly<Record<string, unknown>>, key: number | string, value: unknown) {
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
