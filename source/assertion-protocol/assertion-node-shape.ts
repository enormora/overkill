import type { ThrownErrorRecord } from './thrown-error-record.ts';

export const assertionSources = [ 'assert', 'require' ] as const;

export type NonEmptyReadonlyArray<Item> = readonly [Item, ...(readonly Item[])];

export type AssertionSource = (typeof assertionSources)[number];

export type AssertionOptions = {
    readonly message: string;
};

export type SourceLocation = {
    readonly column: number | null;
    readonly file: string;
    readonly line: number | null;
};

export type SourceLocationProvider = () => SourceLocation;

export type ResolvableSourceLocation = SourceLocation | SourceLocationProvider;

type FailedCheckBase = {
    readonly id: string;
    readonly location: SourceLocation;
    readonly path: readonly (number | string)[];
    readonly source: AssertionSource;
    readonly summary: string;
};

export type FailedLeafCheck = FailedCheckBase & {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly kind: 'leaf';
};

export type FailedCompositeCheck = FailedCheckBase & {
    readonly actual: unknown;
    readonly children: NonEmptyReadonlyArray<FailedCheck>;
    readonly expected: unknown;
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
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: Source;
};

export type ExpectedAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly expected: unknown;
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: Source;
};
