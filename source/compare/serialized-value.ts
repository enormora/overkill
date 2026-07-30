import {
    defaultSerializationBudget as serializedValueBudget,
    type SerializationBudget as SerializationBudgetShape,
    type SerializationTruncation as SerializationTruncationShape,
    type SerializedBytes,
    type SerializedMapEntry as SerializedMapEntryShape,
    type SerializedProperty as SerializedPropertyShape,
    type SerializedPropertyKey as SerializedPropertyKeyShape,
    type SerializedValue as SerializedValueShape
} from './serialized-value-shape.ts';
import {
    constructorName,
    isArrayBufferValue,
    isArrayBufferView,
    isBufferValue,
    isDateValue,
    isErrorValue,
    isPromiseValue,
    isRegExpValue,
    isWeakMapValue,
    isWeakSetValue,
    prototypeIs
} from './serialized-value-classification.ts';
import {
    accountValue,
    createState,
    nextReferenceId,
    referenceFor,
    truncation,
    type SerializationState
} from './serialized-value-state.ts';

export type SerializationTruncation = SerializationTruncationShape;
export type SerializedPropertyKey = SerializedPropertyKeyShape;
export type SerializedProperty = SerializedPropertyShape;
export type SerializedMapEntry = SerializedMapEntryShape;
export type SerializedValue = SerializedValueShape;
export type SerializationBudget = SerializationBudgetShape;

export const defaultSerializationBudget: SerializationBudget = serializedValueBudget;

type ByteSource = ArrayBuffer | ArrayBufferView;

type BinaryObject = ArrayBuffer | ArrayBufferView;
type BuiltInObject = Date | Error | Promise<unknown> | RegExp;
type CollectionObject = ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>;
type WeakCollectionObject = WeakMap<Record<string, unknown>, unknown> | WeakSet<Record<string, unknown>>;
type StrongObject = BinaryObject | BuiltInObject | CollectionObject;
type SerializableObject = Readonly<Record<string, unknown>> | StrongObject | WeakCollectionObject;

type ValueSerializer = (value: unknown, state: SerializationState, depth: number) => SerializedValue;

type AvailableDescriptors = {
    readonly descriptors: PropertyDescriptorMap;
    readonly kind: 'available';
};

type UnavailableDescriptors = {
    readonly kind: 'unavailable';
    readonly reason: string;
};

type DescriptorResult = AvailableDescriptors | UnavailableDescriptors;

function symbolText(value: symbol): string {
    const globalKey = Symbol.keyFor(value);

    if (globalKey !== undefined) {
        return `Symbol.for(${globalKey})`;
    }

    return value.toString();
}

function serializePropertyKey(key: PropertyKey): SerializedPropertyKey {
    return typeof key === 'symbol'
        ? { kind: 'symbol', value: symbolText(key) }
        : { kind: 'string', value: String(key) };
}

function propertyKeySortText(key: SerializedPropertyKey): string {
    return `${key.kind}:${key.value}`;
}

function sortProperties(entries: readonly SerializedProperty[]): readonly SerializedProperty[] {
    return entries.toSorted(function compareEntries(first, second) {
        return propertyKeySortText(first.key).localeCompare(propertyKeySortText(second.key));
    });
}

function objectDescriptors(value: SerializableObject): DescriptorResult {
    try {
        return {
            descriptors: Object.getOwnPropertyDescriptors(value),
            kind: 'available'
        };
    } catch (error) {
        return {
            kind: 'unavailable',
            reason: error instanceof Error ? error.message : 'object introspection failed'
        };
    }
}

function truncateString(value: string, state: SerializationState): SerializedValue {
    if (Buffer.byteLength(value, 'utf8') <= state.budget.stringBytes) {
        return { kind: 'string', truncation: null, value };
    }

    let output = '';

    for (const character of value) {
        const nextOutput = `${output}${character}`;

        if (Buffer.byteLength(nextOutput, 'utf8') > state.budget.stringBytes) {
            break;
        }

        output = nextOutput;
    }

    return {
        kind: 'string',
        truncation: truncation('string-bytes', state.budget.stringBytes),
        value: output
    };
}

function serializeNumber(value: number): SerializedValue {
    if (Object.is(value, -0)) {
        return { kind: 'number', value: '-0' };
    }

    if (Number.isNaN(value)) {
        return { kind: 'number', value: 'NaN' };
    }

    if (value === Number.POSITIVE_INFINITY) {
        return { kind: 'number', value: 'Infinity' };
    }

    if (value === Number.NEGATIVE_INFINITY) {
        return { kind: 'number', value: '-Infinity' };
    }

    return { kind: 'number', value };
}

function serializeEmptyPrimitive(value: unknown): SerializedValue | null {
    if (value === null) {
        return { kind: 'null' };
    }

    if (value === undefined) {
        return { kind: 'undefined' };
    }

    return null;
}

function serializeScalarPrimitive(value: unknown): SerializedValue | null {
    if (typeof value === 'boolean') {
        return { kind: 'boolean', value };
    }

    if (typeof value === 'number') {
        return serializeNumber(value);
    }

    if (typeof value === 'bigint') {
        return { kind: 'bigint', value: value.toString() };
    }

    return null;
}

function serializeTextPrimitive(value: unknown, state: SerializationState): SerializedValue | null {
    if (typeof value === 'string') {
        return truncateString(value, state);
    }

    if (typeof value === 'symbol') {
        return { kind: 'symbol', value: symbolText(value) };
    }

    return null;
}

function serializePrimitive(value: unknown, state: SerializationState): SerializedValue | null {
    return serializeEmptyPrimitive(value) ?? serializeScalarPrimitive(value) ?? serializeTextPrimitive(value, state);
}

function isSerializableObject(value: unknown): value is SerializableObject {
    return value !== null && typeof value === 'object';
}

function objectPropertyEntries(
    value: SerializableObject,
    state: SerializationState,
    depth: number,
    serialize: ValueSerializer
): readonly SerializedProperty[] {
    const descriptorResult = objectDescriptors(value);

    if (descriptorResult.kind === 'unavailable') {
        return [
            {
                key: { kind: 'string', value: '<introspection>' },
                value: { kind: 'unavailable', reason: descriptorResult.reason }
            }
        ];
    }

    const { descriptors } = descriptorResult;
    const keys = Reflect.ownKeys(descriptors).filter(function isEnumerableDataKey(key) {
        const descriptor = descriptors[key];

        return descriptor?.enumerable === true;
    });
    const visibleKeys = keys.slice(0, state.budget.objectEntries);

    return sortProperties(visibleKeys.map(function serializeEntry(key) {
        const descriptor = descriptors[key];
        const keyValue = serializePropertyKey(key);

        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
            return {
                key: keyValue,
                value: { kind: 'unavailable', reason: 'accessor property was not invoked' }
            };
        }

        return {
            key: keyValue,
            value: serialize(descriptor.value, state, depth + 1)
        };
    }));
}

function propertyTruncation(
    value: SerializableObject,
    state: SerializationState
): SerializationTruncation | null {
    const descriptorResult = objectDescriptors(value);

    if (descriptorResult.kind === 'unavailable') {
        return null;
    }

    const keys = Reflect.ownKeys(descriptorResult.descriptors);
    const enumerableKeys = keys.filter(function isEnumerableKey(key) {
        return descriptorResult.descriptors[key]?.enumerable === true;
    });

    return enumerableKeys.length > state.budget.objectEntries
        ? truncation('object-entries', state.budget.objectEntries)
        : null;
}

function bytesFrom(value: ByteSource): Uint8Array {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function serializedBytes(value: ByteSource, state: SerializationState): SerializedBytes {
    const bytes = bytesFrom(value);
    const visibleBytes = Array.from(bytes.slice(0, state.budget.arrayEntries));

    return {
        byteLength: bytes.byteLength,
        bytes: visibleBytes,
        truncation: bytes.byteLength > visibleBytes.length
            ? truncation('array-entries', state.budget.arrayEntries)
            : null
    };
}

function serializeArray(
    value: readonly unknown[],
    state: SerializationState,
    depth: number,
    serialize: ValueSerializer
): SerializedValue {
    const visibleLength = Math.min(value.length, state.budget.arrayEntries);
    const entries: SerializedProperty[] = [];

    for (let index = 0; index < visibleLength; index += 1) {
        if (Object.hasOwn(value, index)) {
            entries.push({
                key: { kind: 'string', value: String(index) },
                value: serialize(value[index], state, depth + 1)
            });
        } else {
            entries.push({
                key: { kind: 'string', value: String(index) },
                value: { kind: 'unavailable', reason: 'array hole' }
            });
        }
    }

    return {
        entries,
        kind: 'array',
        length: value.length,
        truncation: value.length > visibleLength ? truncation('array-entries', state.budget.arrayEntries) : null
    };
}

function mapEntries(
    value: ReadonlyMap<unknown, unknown>,
    state: SerializationState
): readonly [unknown, unknown][] | null {
    try {
        const entries = Array.from(value);

        return entries.slice(0, state.budget.objectEntries);
    } catch {
        return null;
    }
}

function serializeMap(
    value: ReadonlyMap<unknown, unknown>,
    state: SerializationState,
    depth: number,
    serialize: ValueSerializer
): SerializedValue {
    const entries = mapEntries(value, state);

    if (entries === null) {
        return { kind: 'unavailable', reason: 'map introspection failed' };
    }

    return {
        entries: entries.map(function serializeEntry([ key, entryValue ]) {
            return {
                key: serialize(key, state, depth + 1),
                value: serialize(entryValue, state, depth + 1)
            };
        }),
        kind: 'map',
        size: value.size,
        truncation: value.size > entries.length ? truncation('object-entries', state.budget.objectEntries) : null
    };
}

function setValues(value: ReadonlySet<unknown>, state: SerializationState): readonly unknown[] | null {
    try {
        return Array.from(value).slice(0, state.budget.objectEntries);
    } catch {
        return null;
    }
}

function serializeSet(
    value: ReadonlySet<unknown>,
    state: SerializationState,
    depth: number,
    serialize: ValueSerializer
): SerializedValue {
    const values = setValues(value, state);

    if (values === null) {
        return { kind: 'unavailable', reason: 'set introspection failed' };
    }

    return {
        kind: 'set',
        size: value.size,
        truncation: value.size > values.length ? truncation('object-entries', state.budget.objectEntries) : null,
        values: values.map(function serializeSetValue(valueEntry) {
            return serialize(valueEntry, state, depth + 1);
        })
    };
}

function serializeFunction(value: WeakKey & { readonly name?: string; }, state: SerializationState): SerializedValue {
    const reference = referenceFor(state, value);

    if (reference !== null) {
        return { kind: 'circular', reference };
    }

    return {
        id: nextReferenceId(state) - 1,
        kind: 'function',
        name: value.name === undefined || value.name.length === 0 ? null : value.name
    };
}

type ObjectSerializerContext = {
    readonly depth: number;
    readonly serialize: ValueSerializer;
    readonly state: SerializationState;
};

type ObjectSerializer = (
    value: SerializableObject,
    context: ObjectSerializerContext
) => SerializedValue | null;

function isMapValue(value: SerializableObject): value is ReadonlyMap<unknown, unknown> {
    return prototypeIs(value, Map.prototype);
}

function isSetValue(value: SerializableObject): value is ReadonlySet<unknown> {
    return prototypeIs(value, Set.prototype);
}

function typedArrayLength(value: ArrayBufferView): number {
    const lengthValue: unknown = Reflect.get(value, 'length');

    return typeof lengthValue === 'number' ? lengthValue : value.byteLength;
}

function serializeArrayObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return Array.isArray(value) ? serializeArray(value, context.state, context.depth, context.serialize) : null;
}

function serializeBufferObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return isBufferValue(value)
        ? {
            constructorName: 'Buffer',
            kind: 'typed-array',
            length: value.length,
            ...serializedBytes(value, context.state)
        }
        : null;
}

function serializeArrayBufferViewObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    if (!isArrayBufferView(value)) {
        return null;
    }

    return value instanceof DataView
        ? { kind: 'data-view', ...serializedBytes(value, context.state) }
        : {
            constructorName: constructorName(value),
            kind: 'typed-array',
            length: typedArrayLength(value),
            ...serializedBytes(value, context.state)
        };
}

function serializeArrayBufferObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return isArrayBufferValue(value) ? { kind: 'array-buffer', ...serializedBytes(value, context.state) } : null;
}

function serializeMapObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return isMapValue(value) ? serializeMap(value, context.state, context.depth, context.serialize) : null;
}

function serializeSetObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return isSetValue(value) ? serializeSet(value, context.state, context.depth, context.serialize) : null;
}

function serializeDateObject(value: SerializableObject): SerializedValue | null {
    if (!isDateValue(value)) {
        return null;
    }

    const time = value.getTime();

    return { kind: 'date', value: Number.isNaN(time) ? null : value.toISOString() };
}

function serializeRegExpObject(value: SerializableObject): SerializedValue | null {
    return isRegExpValue(value) ? { flags: value.flags, kind: 'regexp', source: value.source } : null;
}

function serializeErrorObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    return isErrorValue(value)
        ? {
            entries: objectPropertyEntries(value, context.state, context.depth, context.serialize),
            kind: 'error',
            message: value.message,
            name: value.name,
            truncation: propertyTruncation(value, context.state)
        }
        : null;
}

function serializeOpaqueObject(value: SerializableObject): SerializedValue | null {
    if (isPromiseValue(value)) {
        return { kind: 'opaque', type: 'promise' };
    }

    if (isWeakMapValue(value)) {
        return { kind: 'opaque', type: 'weak-map' };
    }

    return isWeakSetValue(value) ? { kind: 'opaque', type: 'weak-set' } : null;
}

const objectSerializers: readonly ObjectSerializer[] = [
    serializeArrayObject,
    serializeBufferObject,
    serializeArrayBufferViewObject,
    serializeArrayBufferObject,
    serializeMapObject,
    serializeSetObject,
    serializeDateObject,
    serializeRegExpObject,
    serializeErrorObject,
    serializeOpaqueObject
];

function specializedObject(
    value: SerializableObject,
    context: ObjectSerializerContext
): SerializedValue | null {
    for (const serializer of objectSerializers) {
        const serialized = serializer(value, context);

        if (serialized !== null) {
            return serialized;
        }
    }

    return null;
}

function plainObject(value: SerializableObject, context: ObjectSerializerContext): SerializedValue {
    return {
        constructorName: constructorName(value),
        entries: objectPropertyEntries(value, context.state, context.depth, context.serialize),
        kind: 'object',
        truncation: propertyTruncation(value, context.state)
    };
}

function serializeObject(
    value: SerializableObject,
    state: SerializationState,
    depth: number,
    serialize: ValueSerializer
): SerializedValue {
    if (depth > state.budget.depth) {
        return {
            kind: 'unavailable',
            reason: `depth budget reached: ${state.budget.depth}`
        };
    }

    const reference = referenceFor(state, value);

    if (reference !== null) {
        return { kind: 'circular', reference };
    }

    const context = { depth, serialize, state };

    return specializedObject(value, context) ?? plainObject(value, context);
}

function serializeAny(value: unknown, state: SerializationState, depth: number): SerializedValue {
    const primitive = serializePrimitive(value, state);

    if (primitive !== null) {
        return accountValue(state, primitive);
    }

    if (typeof value === 'function') {
        return accountValue(state, serializeFunction(value, state));
    }

    if (isSerializableObject(value)) {
        return accountValue(state, serializeObject(value, state, depth, serializeAny));
    }

    return accountValue(state, { kind: 'unavailable', reason: `unsupported value type: ${typeof value}` });
}

export function serializeValue(value: unknown): SerializedValue {
    return serializeAny(value, createState(defaultSerializationBudget), 0);
}

export function serializeValueWithBudget(value: unknown, budget: SerializationBudget): SerializedValue {
    return serializeAny(value, createState(budget), 0);
}
