import type { SerializedPropertyKey, SerializedValue } from '../compare/serialized-value.ts';

type BytePathSegment = {
    readonly kind: 'byte';
    readonly offset: number;
};

type IndexPathSegment = {
    readonly index: number;
    readonly kind: 'index';
};

type MapPathSegment = {
    readonly key: SerializedValue;
    readonly kind: 'map-key' | 'map-value';
};

type PropertyPathSegment = {
    readonly key: SerializedPropertyKey;
    readonly kind: 'property';
};

type SetValuePathSegment = {
    readonly kind: 'set-value';
    readonly value: SerializedValue;
};

type IndexedPathSegment = BytePathSegment | IndexPathSegment;

type KeyedPathSegment = MapPathSegment | PropertyPathSegment | SetValuePathSegment;

export type DiffPathSegment = IndexedPathSegment | KeyedPathSegment;

type ReplaceOperation = {
    readonly from: SerializedValue;
    readonly operation: 'replace';
    readonly path: readonly DiffPathSegment[];
    readonly to: SerializedValue;
};

type AddOperation = {
    readonly operation: 'add';
    readonly path: readonly DiffPathSegment[];
    readonly value: SerializedValue;
};

type RemoveOperation = {
    readonly operation: 'remove';
    readonly path: readonly DiffPathSegment[];
    readonly value: SerializedValue;
};

type MissingPropertyOperation = {
    readonly operation: 'missing-property';
    readonly path: readonly DiffPathSegment[];
    readonly value: SerializedValue;
};

type MissingIndexOperation = {
    readonly index: number;
    readonly operation: 'missing-index';
    readonly value: SerializedValue;
};

type MissingArrayMemberOperation = {
    readonly operation: 'missing-member';
    readonly value: SerializedValue;
};

type MissingEntryOperation = {
    readonly key: SerializedValue;
    readonly operation: 'missing-entry';
    readonly value: SerializedValue;
};

type MissingMemberOperation = {
    readonly operation: 'missing-member';
    readonly value: SerializedValue;
};

type ArrayPresenceOperation = MissingArrayMemberOperation | MissingIndexOperation;

export type ArrayDiffOperation = AddOperation | ArrayPresenceOperation | RemoveOperation | ReplaceOperation;

export type MapDiffOperation = AddOperation | MissingEntryOperation | RemoveOperation | ReplaceOperation;

export type ObjectDiffOperation = AddOperation | MissingPropertyOperation | RemoveOperation | ReplaceOperation;

export type SetDiffOperation = AddOperation | MissingMemberOperation | RemoveOperation;

export type ByteDiffRange = {
    readonly actual: readonly number[];
    readonly expected: readonly number[];
    readonly offset: number;
};

export type Hunk = {
    readonly actualStart: number;
    readonly added: readonly string[];
    readonly expectedStart: number;
    readonly removed: readonly string[];
};

type ArrayDiff = {
    readonly kind: 'array';
    readonly operations: readonly ArrayDiffOperation[];
};

type BinaryDiff = {
    readonly actualHash: string;
    readonly actualSize: number;
    readonly expectedHash: string;
    readonly expectedSize: number;
    readonly kind: 'binary';
    readonly ranges: readonly ByteDiffRange[];
};

type MapDiff = {
    readonly kind: 'map';
    readonly operations: readonly MapDiffOperation[];
};

type ObjectDiff = {
    readonly kind: 'object';
    readonly operations: readonly ObjectDiffOperation[];
};

type SetDiff = {
    readonly kind: 'set';
    readonly operations: readonly SetDiffOperation[];
};

type StringDiff = {
    readonly actual: string;
    readonly expected: string;
    readonly hunks: readonly Hunk[];
    readonly kind: 'string';
};

type ValueDiff = {
    readonly actual: SerializedValue;
    readonly expected: SerializedValue;
    readonly kind: 'value';
};

export type Diff = ArrayDiff | BinaryDiff | MapDiff | ObjectDiff | SetDiff | StringDiff | ValueDiff;
