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

export type FailedCheck = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly id: string;
    readonly location: SourceLocation;
    readonly path: readonly (number | string)[];
    readonly source: AssertionSource;
    readonly summary: string;
};

export type InstanceConstructor = abstract new (...args: never[]) => unknown;

export type ActualAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly message: string | null;
    readonly source: Source;
};

export type ExpectedAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly expected: unknown;
    readonly message: string | null;
    readonly source: Source;
};
