import type {
    BuiltInAssertAssertionNode,
    CompositeAssertionChildNode,
    ForeignAssertionNode
} from './assertion-node.ts';
import type { AssertionSource, InstanceConstructor, NonEmptyReadonlyArray } from './assertion-node-shape.ts';
import { createThrownErrorRecord } from './thrown-error-record.ts';

const assertionReferenceIdentity: unique symbol = Symbol('OverkillAssertionReference');
const compositeGroupIdentity: unique symbol = Symbol('OverkillCompositeGroup');

export type CompositeAssertionSummaryContext = {
    readonly name: string;
    readonly source: AssertionSource;
};

export type CompositeAssertionGroup<Source extends AssertionSource = AssertionSource> = {
    readonly [compositeGroupIdentity]: true;
    readonly children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>;
};

type CompositeAssertionReturnByKind<Source extends AssertionSource> = {
    readonly child: CompositeAssertionChildNode<Source>;
    readonly group: CompositeAssertionGroup<Source>;
};

export type CompositeAssertionReturn<Source extends AssertionSource = AssertionSource> = CompositeAssertionReturnByKind<
    Source
>[keyof CompositeAssertionReturnByKind<Source>];

type AssertCompositeAssertionReturn = CompositeAssertionReturn<'assert'> | Promise<CompositeAssertionReturn<'assert'>>;

type SyncAssertionReturn = ReturnType<() => void>;

type CompositeAssertionSummaryFormatter<Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    ...parameters: Arguments
) => string;

type NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    actual: Actual,
    ...parameters: Arguments
) => string;

export type CompositeCheckBuilder<Source extends AssertionSource = AssertionSource> = {
    readonly annotated: (message: string) => CompositeCheckBuilder<Source>;
    readonly array: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly arrayContainsPartial: (
        actual: readonly unknown[],
        expectedSubset: unknown
    ) => BuiltInAssertAssertionNode<Source>;
    readonly between: (actual: number, minimum: number, maximum: number) => BuiltInAssertAssertionNode<Source>;
    readonly boolean: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly deepEqual: (actual: unknown, expected: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly defined: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly empty: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly endsWith: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly equal: (actual: unknown, expected: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly fail: () => BuiltInAssertAssertionNode<Source>;
    readonly false: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly fromRejectable: (label: string, body: () => Promise<void>) => Promise<ForeignAssertionNode<Source>>;
    readonly fromThrowable: (label: string, body: () => void) => ForeignAssertionNode<Source>;
    readonly function: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly greaterThan: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly greaterThanOrEqual: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly group: (
        children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>
    ) => CompositeAssertionGroup<Source>;
    readonly hasProperty: (actual: unknown, key: PropertyKey) => BuiltInAssertAssertionNode<Source>;
    readonly includes: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly instanceOf: (actual: unknown, expected: InstanceConstructor) => BuiltInAssertAssertionNode<Source>;
    readonly length: (actual: unknown, expectedLength: number) => BuiltInAssertAssertionNode<Source>;
    readonly lessThan: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly lessThanOrEqual: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly match: (actual: string, pattern: RegExp) => BuiltInAssertAssertionNode<Source>;
    readonly membersPartialDeepEqual: (
        actual: readonly unknown[],
        expectedMembers: readonly unknown[]
    ) => BuiltInAssertAssertionNode<Source>;
    readonly notDeepEqual: (actual: unknown, expected: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly notEmpty: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly notEqual: (actual: unknown, expected: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly notMatch: (actual: string, pattern: RegExp) => BuiltInAssertAssertionNode<Source>;
    readonly notNull: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly null: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly number: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly object: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly partialDeepEqual: (actual: unknown, expectedSubset: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly startsWith: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly string: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly true: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly undefined: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
};

export type CompositeAssertionDefinition<
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
> = {
    readonly formatSummary?: CompositeAssertionSummaryFormatter<Arguments>;
    readonly name: string;
    readonly assert: (check: CompositeCheckBuilder<'assert'>, ...parameters: Arguments) => Result;
};

export type NarrowingCompositeAssertionDefinition<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
> = {
    readonly formatSummary?: NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments>;
    readonly name: string;
    readonly narrows: (actual: Actual, ...parameters: Arguments) => actual is Narrowed;
};

export type CompositeAssertionReference<
    Arguments extends readonly unknown[] = readonly unknown[],
    Result extends AssertCompositeAssertionReturn = AssertCompositeAssertionReturn
> = {
    readonly [assertionReferenceIdentity]: true;
    readonly formatSummary: CompositeAssertionSummaryFormatter<Arguments> | null;
    readonly kind: 'composite';
    readonly name: string;
    readonly assert: (check: CompositeCheckBuilder<'assert'>, ...parameters: Arguments) => Result;
};

export type NarrowingCompositeAssertionReference<
    Actual = unknown,
    Narrowed extends Actual = Actual,
    Arguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly [assertionReferenceIdentity]: true;
    readonly formatSummary: NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments> | null;
    readonly kind: 'narrowing-composite';
    readonly name: string;
    readonly narrows: (actual: Actual, ...parameters: Arguments) => actual is Narrowed;
};

export type AssertionReference = CompositeAssertionReference | NarrowingCompositeAssertionReference;

type NarrowingReferenceArguments<Actual, Arguments extends readonly unknown[]> = readonly [
    actual: Actual,
    ...parameters: Arguments
];

type ReferenceArguments<Reference> = Reference extends NarrowingCompositeAssertionReference<
    infer Actual,
    infer Narrowed,
    infer Arguments
> ? NarrowingReferenceArguments<Actual | Narrowed, Arguments>
    : never;

type ReferenceReturn<Result> = Result extends Promise<CompositeAssertionReturn<'assert'>> ? Promise<void>
    : SyncAssertionReturn;

type ReadonlyParameters<Arguments extends readonly unknown[]> = readonly [...Arguments];

export type AssertReferenceArguments<Reference> = Reference extends CompositeAssertionReference<infer Arguments>
    ? ReadonlyParameters<Arguments>
    : ReferenceArguments<Reference>;

export type AssertReferenceReturn<Reference> = Reference extends CompositeAssertionReference<
    infer Arguments,
    infer Result
> ? Arguments extends readonly unknown[] ? ReferenceReturn<Result> : never
    : SyncAssertionReturn;

function ensureAssertionName(name: string): void {
    if (name.trim().length === 0) {
        throw new TypeError('Assertion reference name must not be empty.');
    }
}

export function defineCompositeAssertion<
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
>(definition: CompositeAssertionDefinition<Arguments, Result>): CompositeAssertionReference<Arguments, Result> {
    ensureAssertionName(definition.name);

    return {
        [assertionReferenceIdentity]: true,
        assert: definition.assert,
        formatSummary: definition.formatSummary ?? null,
        kind: 'composite',
        name: definition.name
    };
}

export function defineNarrowingCompositeAssertion<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
>(
    definition: NarrowingCompositeAssertionDefinition<Actual, Narrowed, Arguments>
): NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments> {
    ensureAssertionName(definition.name);

    return {
        [assertionReferenceIdentity]: true,
        formatSummary: definition.formatSummary ?? null,
        kind: 'narrowing-composite',
        name: definition.name,
        narrows: definition.narrows
    };
}

export function isAssertionReference(value: unknown): value is AssertionReference {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, assertionReferenceIdentity);
}

export function isNarrowingAssertionReference(value: unknown): value is NarrowingCompositeAssertionReference {
    return isAssertionReference(value) && value.kind === 'narrowing-composite';
}

export function isCompositeAssertionGroup<Source extends AssertionSource>(
    value: unknown
): value is CompositeAssertionGroup<Source> {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, compositeGroupIdentity);
}

function createForeignAssertionNode<Source extends AssertionSource>(
    source: Source,
    message: string | null,
    label: string,
    result: ForeignAssertionNode<Source>['result']
): ForeignAssertionNode<Source> {
    return {
        check: 'foreign',
        label,
        message,
        result,
        source,
        summary: result.passed
            ? `Expected foreign assertion ${label} to pass.`
            : `${label}: ${result.error.message}`
    };
}

export function createCompositeCheckBuilder<Source extends AssertionSource>(
    source: Source,
    message: string | null
): CompositeCheckBuilder<Source> {
    return {
        annotated(childMessage) {
            return createCompositeCheckBuilder(source, childMessage);
        },

        array(actual) {
            return { actual, check: 'array', message, source };
        },

        arrayContainsPartial(actual, expected) {
            return { actual, check: 'array-contains-partial', expected, message, source };
        },

        between(actual, minimum, maximum) {
            return { actual, check: 'between', maximum, message, minimum, source };
        },

        boolean(actual) {
            return { actual, check: 'boolean', message, source };
        },

        deepEqual(actual, expected) {
            return { actual, check: 'deep-equal', expected, message, source };
        },

        defined(actual) {
            return { actual, check: 'defined', message, source };
        },

        empty(actual) {
            return { actual, check: 'empty', message, source };
        },

        endsWith(actual, expected) {
            return { actual, check: 'ends-with', expected, message, source };
        },

        equal(actual, expected) {
            return { actual, check: 'equal', expected, message, source };
        },

        fail() {
            return { check: 'fail', message, source };
        },

        false(actual) {
            return { actual, check: 'false', message, source };
        },

        async fromRejectable(label, body) {
            try {
                await body();

                return createForeignAssertionNode(source, message, label, { passed: true });
            } catch (error: unknown) {
                return createForeignAssertionNode(source, message, label, {
                    error: createThrownErrorRecord(error),
                    passed: false
                });
            }
        },

        fromThrowable(label, body) {
            try {
                body();

                return createForeignAssertionNode(source, message, label, { passed: true });
            } catch (error: unknown) {
                return createForeignAssertionNode(source, message, label, {
                    error: createThrownErrorRecord(error),
                    passed: false
                });
            }
        },

        function(actual) {
            return { actual, check: 'function', message, source };
        },

        greaterThan(actual, expected) {
            return { actual, check: 'greater-than', expected, message, source };
        },

        greaterThanOrEqual(actual, expected) {
            return { actual, check: 'greater-than-or-equal', expected, message, source };
        },

        group(children) {
            return { [compositeGroupIdentity]: true, children };
        },

        hasProperty(actual, key) {
            return { actual, check: 'has-property', key, message, source };
        },

        includes(actual, expected) {
            return { actual, check: 'includes', expected, message, source };
        },

        instanceOf(actual, expected) {
            return { actual, check: 'instance-of', expected, message, source };
        },

        length(actual, expectedLength) {
            return { actual, check: 'length', expectedLength, message, source };
        },

        lessThan(actual, expected) {
            return { actual, check: 'less-than', expected, message, source };
        },

        lessThanOrEqual(actual, expected) {
            return { actual, check: 'less-than-or-equal', expected, message, source };
        },

        match(actual, pattern) {
            return { actual, check: 'match', message, pattern, source };
        },

        membersPartialDeepEqual(actual, expected) {
            return { actual, check: 'members-partial-deep-equal', expected, message, source };
        },

        notDeepEqual(actual, expected) {
            return { actual, check: 'not-deep-equal', expected, message, source };
        },

        notEmpty(actual) {
            return { actual, check: 'not-empty', message, source };
        },

        notEqual(actual, expected) {
            return { actual, check: 'not-equal', expected, message, source };
        },

        notMatch(actual, pattern) {
            return { actual, check: 'not-match', message, pattern, source };
        },

        notNull(actual) {
            return { actual, check: 'not-null', message, source };
        },

        null(actual) {
            return { actual, check: 'null', message, source };
        },

        number(actual) {
            return { actual, check: 'number', message, source };
        },

        object(actual) {
            return { actual, check: 'object', message, source };
        },

        partialDeepEqual(actual, expected) {
            return { actual, check: 'partial-deep-equal', expected, message, source };
        },

        startsWith(actual, expected) {
            return { actual, check: 'starts-with', expected, message, source };
        },

        string(actual) {
            return { actual, check: 'string', message, source };
        },

        true(actual) {
            return { actual, check: 'true', message, source };
        },

        undefined(actual) {
            return { actual, check: 'undefined', message, source };
        }
    };
}
