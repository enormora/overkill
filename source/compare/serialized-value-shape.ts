type CollectionTruncationReason = 'array-entries' | 'object-entries';

type ValueTruncationReason = 'depth' | 'serialized-bytes' | 'string-bytes' | 'visited-nodes';

type SerializationTruncationReason = CollectionTruncationReason | ValueTruncationReason;

export type SerializationTruncation = {
    readonly budget: number;
    readonly reason: SerializationTruncationReason;
};

type SerializedStringPropertyKey = {
    readonly kind: 'string';
    readonly value: string;
};

type SerializedSymbolPropertyKey = {
    readonly kind: 'symbol';
    readonly value: string;
};

export type SerializedPropertyKey = SerializedStringPropertyKey | SerializedSymbolPropertyKey;

export type SerializedProperty = {
    readonly key: SerializedPropertyKey;
    readonly value: SerializedValue;
};

export type SerializedMapEntry = {
    readonly key: SerializedValue;
    readonly value: SerializedValue;
};

export type SerializedBytes = {
    readonly bytes: readonly number[];
    readonly byteLength: number;
    readonly truncation: SerializationTruncation | null;
};

type SerializedObjectValue = {
    readonly constructorName: string;
    readonly entries: readonly SerializedProperty[];
    readonly kind: 'object';
    readonly truncation: SerializationTruncation | null;
};

type SerializedErrorValue = {
    readonly entries: readonly SerializedProperty[];
    readonly kind: 'error';
    readonly message: string;
    readonly name: string;
    readonly truncation: SerializationTruncation | null;
};

type SerializedArrayValue = {
    readonly entries: readonly SerializedProperty[];
    readonly kind: 'array';
    readonly length: number;
    readonly truncation: SerializationTruncation | null;
};

type SerializedMapValue = {
    readonly entries: readonly SerializedMapEntry[];
    readonly kind: 'map';
    readonly size: number;
    readonly truncation: SerializationTruncation | null;
};

type SerializedSetValue = {
    readonly kind: 'set';
    readonly size: number;
    readonly truncation: SerializationTruncation | null;
    readonly values: readonly SerializedValue[];
};

type SerializedCollectionValue = SerializedArrayValue | SerializedMapValue | SerializedObjectValue | SerializedSetValue;

type SerializedFunctionValue = {
    readonly id: number;
    readonly kind: 'function';
    readonly name: string | null;
};

type SerializedBigIntValue = { readonly kind: 'bigint'; readonly value: string; };
type SerializedBooleanValue = { readonly kind: 'boolean'; readonly value: boolean; };
type SerializedNullValue = { readonly kind: 'null'; };
type SerializedNumberValue = {
    readonly kind: 'number';
    readonly value: number | '-0' | '-Infinity' | 'Infinity' | 'NaN';
};
type SerializedStringValue = {
    readonly kind: 'string';
    readonly truncation: SerializationTruncation | null;
    readonly value: string;
};
type SerializedSymbolValue = { readonly kind: 'symbol'; readonly value: string; };
type SerializedUndefinedValue = { readonly kind: 'undefined'; };

type SerializedNullishValue = SerializedNullValue | SerializedUndefinedValue;

type SerializedNumericValue = SerializedBigIntValue | SerializedNumberValue;

type SerializedScalarValue = SerializedBooleanValue | SerializedNullishValue | SerializedNumericValue;
type SerializedTextValue = SerializedStringValue | SerializedSymbolValue | SerializedUndefinedValue;
type SerializedPrimitiveValue = SerializedScalarValue | SerializedTextValue;

type SerializedCircularValue = { readonly kind: 'circular'; readonly reference: number; };
type SerializedDateValue = { readonly kind: 'date'; readonly value: string | null; };
type SerializedOpaqueValue = { readonly kind: 'opaque'; readonly type: 'promise' | 'weak-map' | 'weak-set'; };
type SerializedRegExpValue = { readonly kind: 'regexp'; readonly flags: string; readonly source: string; };
type SerializedUnavailableValue = { readonly kind: 'unavailable'; readonly reason: string; };

type SerializedBuiltInCoreValue = SerializedCircularValue | SerializedDateValue | SerializedOpaqueValue;
type SerializedBuiltInValue = SerializedBuiltInCoreValue | SerializedRegExpValue | SerializedUnavailableValue;

type SerializedTypedArrayValue = SerializedBytes & {
    readonly constructorName: string;
    readonly kind: 'typed-array';
    readonly length: number;
};

type SerializedByteViewValue = SerializedBytes & {
    readonly kind: 'array-buffer' | 'data-view';
};

type SerializedReferenceValue = SerializedByteViewValue | SerializedCollectionValue | SerializedTypedArrayValue;

type SerializedRuntimeValue = SerializedBuiltInValue | SerializedErrorValue | SerializedFunctionValue;

export type SerializedValue = SerializedPrimitiveValue | SerializedReferenceValue | SerializedRuntimeValue;

export type SerializationBudget = {
    readonly arrayEntries: number;
    readonly depth: number;
    readonly objectEntries: number;
    readonly operandBytes: number;
    readonly stringBytes: number;
    readonly visitedNodes: number;
};

const bytesPerKilobyte = 1024;
const defaultOperandKilobytes = 64;
const defaultStringKilobytes = 8;

export const defaultSerializationBudget: SerializationBudget = {
    arrayEntries: 100,
    depth: 8,
    objectEntries: 100,
    operandBytes: defaultOperandKilobytes * bytesPerKilobyte,
    stringBytes: defaultStringKilobytes * bytesPerKilobyte,
    visitedNodes: 2000
};
