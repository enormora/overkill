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

type ActualAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly message: string | null;
    readonly source: Source;
};

type ExpectedAssertionNode<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly expected: unknown;
    readonly message: string | null;
    readonly source: Source;
};

export type DefinedAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'defined'
>;

export type NullAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'null'>;

export type NotNullAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'not-null'
>;

export type UndefinedAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'undefined'
>;

export type TrueAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'true'>;

export type FalseAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'false'>;

export type TypeAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'array' | 'boolean' | 'function' | 'number' | 'object' | 'string'
>;

export type InstanceOfAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'instance-of';
    readonly expected: InstanceConstructor;
    readonly message: string | null;
    readonly source: Source;
};

export type HasPropertyAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'has-property';
    readonly key: PropertyKey;
    readonly message: string | null;
    readonly source: Source;
};

export type EqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'equal'
>;

export type NotEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'not-equal'
>;

export type DeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'deep-equal'
>;

export type NotDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'not-deep-equal'
>;

export type PartialDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'partial-deep-equal'
>;

export type ArrayContainsPartialAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'array-contains-partial'
>;

export type MembersPartialDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> =
    ExpectedAssertionNode<Source, 'members-partial-deep-equal'>;

export type NumericComparisonAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
>;

export type BetweenAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'between';
    readonly maximum: number;
    readonly message: string | null;
    readonly minimum: number;
    readonly source: Source;
};

export type MatchAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'match' | 'not-match';
    readonly message: string | null;
    readonly pattern: RegExp;
    readonly source: Source;
};

export type StringContainsAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'ends-with' | 'includes' | 'starts-with'
>;

export type LengthAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'length';
    readonly expectedLength: number;
    readonly message: string | null;
    readonly source: Source;
};

export type EmptinessAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'empty' | 'not-empty'
>;

export type FailAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly check: 'fail';
    readonly message: string | null;
    readonly source: Source;
};

type RequireAssertionNodeByName = {
    readonly defined: DefinedAssertionNode<'require'>;
    readonly hasProperty: HasPropertyAssertionNode<'require'>;
    readonly instanceOf: InstanceOfAssertionNode<'require'>;
    readonly notNull: NotNullAssertionNode<'require'>;
    readonly null: NullAssertionNode<'require'>;
    readonly type: TypeAssertionNode<'require'>;
};

type AssertAssertionNodeByName = {
    readonly arrayContainsPartial: ArrayContainsPartialAssertionNode<'assert'>;
    readonly between: BetweenAssertionNode<'assert'>;
    readonly deepEqual: DeepEqualAssertionNode<'assert'>;
    readonly defined: DefinedAssertionNode<'assert'>;
    readonly emptiness: EmptinessAssertionNode<'assert'>;
    readonly equal: EqualAssertionNode<'assert'>;
    readonly fail: FailAssertionNode<'assert'>;
    readonly false: FalseAssertionNode<'assert'>;
    readonly hasProperty: HasPropertyAssertionNode<'assert'>;
    readonly instanceOf: InstanceOfAssertionNode<'assert'>;
    readonly length: LengthAssertionNode<'assert'>;
    readonly match: MatchAssertionNode<'assert'>;
    readonly membersPartialDeepEqual: MembersPartialDeepEqualAssertionNode<'assert'>;
    readonly notDeepEqual: NotDeepEqualAssertionNode<'assert'>;
    readonly notEqual: NotEqualAssertionNode<'assert'>;
    readonly notNull: NotNullAssertionNode<'assert'>;
    readonly null: NullAssertionNode<'assert'>;
    readonly numericComparison: NumericComparisonAssertionNode<'assert'>;
    readonly partialDeepEqual: PartialDeepEqualAssertionNode<'assert'>;
    readonly stringContains: StringContainsAssertionNode<'assert'>;
    readonly true: TrueAssertionNode<'assert'>;
    readonly type: TypeAssertionNode<'assert'>;
    readonly undefined: UndefinedAssertionNode<'assert'>;
};

export type RequireAssertionNode = RequireAssertionNodeByName[keyof RequireAssertionNodeByName];

export type AssertAssertionNode = AssertAssertionNodeByName[keyof AssertAssertionNodeByName];

export type AssertionNode = AssertAssertionNode | RequireAssertionNode;

export type AssertionResult = AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>;

const defaultSummaryByCheck: Readonly<Record<AssertionNode['check'], string>> = {
    array: 'Expected value to be an array.',
    'array-contains-partial': 'Expected array to contain a partial member.',
    between: 'Expected number to be between the bounds.',
    boolean: 'Expected value to be a boolean.',
    'deep-equal': 'Expected values to be deeply equal.',
    defined: 'Expected value to be defined.',
    empty: 'Expected collection to be empty.',
    'ends-with': 'Expected string to end with the value.',
    equal: 'Expected values to be equal.',
    fail: 'Assertion failed.',
    false: 'Expected value to be false.',
    function: 'Expected value to be a function.',
    'greater-than': 'Expected number to be greater than the threshold.',
    'greater-than-or-equal': 'Expected number to be greater than or equal to the threshold.',
    'has-property': 'Expected object to have the own property.',
    includes: 'Expected string to include the value.',
    'instance-of': 'Expected value to be an instance of the constructor.',
    length: 'Expected collection length to match.',
    'less-than': 'Expected number to be less than the threshold.',
    'less-than-or-equal': 'Expected number to be less than or equal to the threshold.',
    match: 'Expected string to match the pattern.',
    'members-partial-deep-equal': 'Expected array to contain the partial members.',
    'not-deep-equal': 'Expected values not to be deeply equal.',
    'not-empty': 'Expected collection not to be empty.',
    'not-equal': 'Expected values not to be equal.',
    'not-match': 'Expected string not to match the pattern.',
    'not-null': 'Expected value not to be null.',
    null: 'Expected value to be null.',
    number: 'Expected value to be a number.',
    object: 'Expected value to be an object.',
    'partial-deep-equal': 'Expected value to partially match.',
    'starts-with': 'Expected string to start with the value.',
    string: 'Expected value to be a string.',
    true: 'Expected value to be true.',
    undefined: 'Expected value to be undefined.'
};

export function assertionSummary(assertion: AssertionNode): string {
    return assertion.message ?? defaultSummaryByCheck[assertion.check];
}

export type AssertAssertionFacade = {
    readonly annotated: (message: string) => AssertAssertionFacade;
    readonly array: (actual: unknown, options?: AssertionOptions) => void;
    readonly arrayContainsPartial: (
        actual: readonly unknown[],
        expectedSubset: unknown,
        options?: AssertionOptions
    ) => void;
    readonly between: (actual: number, minimum: number, maximum: number, options?: AssertionOptions) => void;
    readonly boolean: (actual: unknown, options?: AssertionOptions) => void;
    readonly deepEqual: (actual: unknown, expected: unknown, options?: AssertionOptions) => void;
    readonly defined: (actual: unknown, options?: AssertionOptions) => void;
    readonly empty: (actual: unknown, options?: AssertionOptions) => void;
    readonly endsWith: (actual: string, expected: string, options?: AssertionOptions) => void;
    readonly equal: (actual: unknown, expected: unknown, options?: AssertionOptions) => void;
    readonly fail: (options?: AssertionOptions) => void;
    readonly false: (actual: unknown, options?: AssertionOptions) => void;
    readonly function: (actual: unknown, options?: AssertionOptions) => void;
    readonly greaterThan: (actual: number, expected: number, options?: AssertionOptions) => void;
    readonly greaterThanOrEqual: (actual: number, expected: number, options?: AssertionOptions) => void;
    readonly hasProperty: (actual: unknown, key: PropertyKey, options?: AssertionOptions) => void;
    readonly includes: (actual: string, expected: string, options?: AssertionOptions) => void;
    readonly instanceOf: (actual: unknown, expected: InstanceConstructor, options?: AssertionOptions) => void;
    readonly length: (actual: unknown, expectedLength: number, options?: AssertionOptions) => void;
    readonly lessThan: (actual: number, expected: number, options?: AssertionOptions) => void;
    readonly lessThanOrEqual: (actual: number, expected: number, options?: AssertionOptions) => void;
    readonly match: (actual: string, pattern: RegExp, options?: AssertionOptions) => void;
    readonly membersPartialDeepEqual: (
        actual: readonly unknown[],
        expectedMembers: readonly unknown[],
        options?: AssertionOptions
    ) => void;
    readonly notDeepEqual: (actual: unknown, expected: unknown, options?: AssertionOptions) => void;
    readonly notEmpty: (actual: unknown, options?: AssertionOptions) => void;
    readonly notEqual: (actual: unknown, expected: unknown, options?: AssertionOptions) => void;
    readonly notMatch: (actual: string, pattern: RegExp, options?: AssertionOptions) => void;
    readonly notNull: (actual: unknown, options?: AssertionOptions) => void;
    readonly null: (actual: unknown, options?: AssertionOptions) => void;
    readonly number: (actual: unknown, options?: AssertionOptions) => void;
    readonly object: (actual: unknown, options?: AssertionOptions) => void;
    readonly partialDeepEqual: (actual: unknown, expectedSubset: unknown, options?: AssertionOptions) => void;
    readonly startsWith: (actual: string, expected: string, options?: AssertionOptions) => void;
    readonly string: (actual: unknown, options?: AssertionOptions) => void;
    readonly true: (actual: unknown, options?: AssertionOptions) => void;
    readonly undefined: (actual: unknown, options?: AssertionOptions) => void;
};

export type RequireAssertionFacade = {
    readonly annotated: (message: string) => RequireAssertionFacade;
    readonly array: (actual: unknown, options?: AssertionOptions) => asserts actual is readonly unknown[];
    readonly boolean: (actual: unknown, options?: AssertionOptions) => asserts actual is boolean;
    readonly defined: <Value>(actual: Value, options?: AssertionOptions) => asserts actual is NonNullable<Value>;
    readonly function: (
        actual: unknown,
        options?: AssertionOptions
    ) => asserts actual is (...parameters: readonly unknown[]) => unknown;
    readonly hasProperty: <Key extends PropertyKey>(
        actual: unknown,
        key: Key,
        options?: AssertionOptions
    ) => asserts actual is Readonly<Record<Key, unknown>>;
    readonly instanceOf: <Constructor extends InstanceConstructor>(
        actual: unknown,
        expected: Constructor,
        options?: AssertionOptions
    ) => asserts actual is InstanceType<Constructor>;
    readonly notNull: <Value>(actual: Value, options?: AssertionOptions) => asserts actual is Exclude<Value, null>;
    readonly null: (actual: unknown, options?: AssertionOptions) => asserts actual is null;
    readonly number: (actual: unknown, options?: AssertionOptions) => asserts actual is number;
    readonly object: (
        actual: unknown,
        options?: AssertionOptions
    ) => asserts actual is Readonly<Record<PropertyKey, unknown>>;
    readonly string: (actual: unknown, options?: AssertionOptions) => asserts actual is string;
};
