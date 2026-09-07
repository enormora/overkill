import type { SerializedValue } from '../compare/serialized-value.ts';
import type { Diff, DiffPathSegment } from '../diff/diff-shape.ts';
import type { ThrownErrorRecord } from './thrown-error-record.ts';

export const assertionSources = [ 'assert', 'require' ] as const;

export type NonEmptyReadonlyArray<Item> = readonly [Item, ...(readonly Item[])];

export type AssertionSource = (typeof assertionSources)[number];

type PrimitiveValueByType = {
    readonly bigint: bigint;
    readonly boolean: boolean;
    readonly null: null;
    readonly number: number;
    readonly string: string;
    readonly symbol: symbol;
    readonly undefined: undefined;
};

type PrimitiveValue = PrimitiveValueByType[keyof PrimitiveValueByType];

type IsAny<Value> = 0 extends Value & 1 ? true : false;

type DeepComparableKnownValue<Value> = [Extract<Value, PrimitiveValue>] extends [never] ? Value : never;

type DeepComparableUnknownValue<Value> = unknown extends Value ? unknown : DeepComparableKnownValue<Value>;

export type DeepComparable<Value = unknown> = IsAny<Value> extends true ? never : DeepComparableUnknownValue<Value>;

export type AssertionOptions = {
    readonly message: string;
};

export type UnknownSourceLocation = {
    readonly column?: never;
    readonly file?: never;
    readonly kind: 'unknown';
    readonly line?: never;
};

export type KnownSourceLocation = {
    readonly column: number | null;
    readonly file: string;
    readonly kind: 'known';
    readonly line: number | null;
};

export type SourceLocation = KnownSourceLocation | UnknownSourceLocation;

export type SourceLocationProvider = () => SourceLocation;

export type ResolvableSourceLocation = SourceLocation | SourceLocationProvider;

export type ResolvableSourceLocations = NonEmptyReadonlyArray<ResolvableSourceLocation>;

type FailedCheckBase = {
    readonly actual: SerializedValue;
    readonly diff: Diff | null;
    readonly expected: SerializedValue;
    readonly id: string;
    readonly path: readonly DiffPathSegment[];
    readonly source: AssertionSource;
    readonly sourceLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly summary: string;
};

export type FailedLeafCheck = FailedCheckBase & {
    readonly kind: 'leaf';
};

export type FailedCompositeCheck = FailedCheckBase & {
    readonly children: NonEmptyReadonlyArray<FailedCheck>;
    readonly kind: 'composite';
};

export type FailedForeignCheck = FailedCheckBase & {
    readonly error: ThrownErrorRecord;
    readonly kind: 'foreign';
    readonly label: string;
};

export type FailedCheck = FailedCompositeCheck | FailedForeignCheck | FailedLeafCheck;

export type InstanceConstructor = abstract new (...args: never[]) => unknown;

export type ActualAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly message: string | null;
    readonly source: Source;
    readonly sourceLocations: ResolvableSourceLocations;
};

export type ExpectedAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly expected: unknown;
    readonly message: string | null;
    readonly source: Source;
    readonly sourceLocations: ResolvableSourceLocations;
};
