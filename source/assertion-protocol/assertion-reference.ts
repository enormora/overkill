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

export type CompositeAssertionReturn<Source extends AssertionSource = AssertionSource> =
    | CompositeAssertionChildNode<Source>
    | CompositeAssertionGroup<Source>;

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
    Result extends CompositeAssertionReturn<'assert'> | Promise<CompositeAssertionReturn<'assert'>>
> = {
    assert(check: CompositeCheckBuilder<'assert'>, ...arguments_: Arguments): Result;
    readonly formatSummary?:
        | ((context: CompositeAssertionSummaryContext, ...arguments_: Arguments) => string)
        | undefined;
    readonly name: string;
};

export type NarrowingCompositeAssertionDefinition<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
> = {
    readonly formatSummary?:
        | ((context: CompositeAssertionSummaryContext, actual: Actual, ...arguments_: Arguments) => string)
        | undefined;
    readonly name: string;
    narrows(actual: Actual, ...arguments_: Arguments): actual is Narrowed;
};

export type CompositeAssertionReference<
    Arguments extends readonly unknown[] = readonly unknown[],
    Result extends CompositeAssertionReturn<'assert'> | Promise<CompositeAssertionReturn<'assert'>> =
        | CompositeAssertionReturn<'assert'>
        | Promise<CompositeAssertionReturn<'assert'>>
> = {
    readonly [assertionReferenceIdentity]: true;
    assert(check: CompositeCheckBuilder<'assert'>, ...arguments_: Arguments): Result;
    readonly formatSummary:
        | ((context: CompositeAssertionSummaryContext, ...arguments_: Arguments) => string)
        | null;
    readonly kind: 'composite';
    readonly name: string;
};

export type NarrowingCompositeAssertionReference<
    Actual = unknown,
    Narrowed extends Actual = Actual,
    Arguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly [assertionReferenceIdentity]: true;
    readonly formatSummary:
        | ((context: CompositeAssertionSummaryContext, actual: Actual, ...arguments_: Arguments) => string)
        | null;
    readonly kind: 'narrowing-composite';
    readonly name: string;
    narrows(actual: Actual, ...arguments_: Arguments): actual is Narrowed;
};

export type AssertionReference = {
    readonly [assertionReferenceIdentity]: true;
    readonly kind: 'composite' | 'narrowing-composite';
    readonly name: string;
};

export type AssertReferenceArguments<Reference> =
    Reference extends CompositeAssertionReference<infer Arguments, CompositeAssertionReturn<'assert'> | Promise<CompositeAssertionReturn<'assert'>>>
        ? Arguments
        : Reference extends NarrowingCompositeAssertionReference<infer Actual, infer Candidate, infer Arguments>
            ? Candidate extends Actual
                ? readonly [actual: Actual, ...arguments_: Arguments]
                : never
            : never;

export type AssertReferenceReturn<Reference> =
    Reference extends CompositeAssertionReference<infer Arguments, infer Result>
        ? Arguments extends readonly unknown[]
            ? Result extends Promise<CompositeAssertionReturn<'assert'>>
                ? Promise<void>
                : void
            : never
        : void;

export function defineCompositeAssertion<
    Arguments extends readonly unknown[],
    Result extends CompositeAssertionReturn<'assert'> | Promise<CompositeAssertionReturn<'assert'>>
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
    value: CompositeAssertionReturn<Source>
): value is CompositeAssertionGroup<Source> {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, compositeGroupIdentity);
}

export function createCompositeCheckBuilder<Source extends AssertionSource>(
    source: Source,
    message: string | null
): CompositeCheckBuilder<Source> {
    function actualNode<Check extends BuiltInAssertAssertionNode<Source>['check']>(
        check: Check,
        actual: unknown
    ): Extract<BuiltInAssertAssertionNode<Source>, { readonly check: Check; }> {
        return { actual, check, message, source } as Extract<
            BuiltInAssertAssertionNode<Source>,
            { readonly check: Check; }
        >;
    }

    function expectedNode<Check extends BuiltInAssertAssertionNode<Source>['check']>(
        check: Check,
        actual: unknown,
        expected: unknown
    ): Extract<BuiltInAssertAssertionNode<Source>, { readonly check: Check; }> {
        return { actual, check, expected, message, source } as Extract<
            BuiltInAssertAssertionNode<Source>,
            { readonly check: Check; }
        >;
    }

    return {
        annotated(childMessage) {
            return createCompositeCheckBuilder(source, childMessage);
        },

        array(actual) {
            return actualNode('array', actual);
        },

        arrayContainsPartial(actual, expected) {
            return expectedNode('array-contains-partial', actual, expected);
        },

        between(actual, minimum, maximum) {
            return { actual, check: 'between', maximum, message, minimum, source };
        },

        boolean(actual) {
            return actualNode('boolean', actual);
        },

        deepEqual(actual, expected) {
            return expectedNode('deep-equal', actual, expected);
        },

        defined(actual) {
            return actualNode('defined', actual);
        },

        empty(actual) {
            return actualNode('empty', actual);
        },

        endsWith(actual, expected) {
            return expectedNode('ends-with', actual, expected);
        },

        equal(actual, expected) {
            return expectedNode('equal', actual, expected);
        },

        fail() {
            return { check: 'fail', message, source };
        },

        false(actual) {
            return actualNode('false', actual);
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
            return actualNode('function', actual);
        },

        greaterThan(actual, expected) {
            return expectedNode('greater-than', actual, expected);
        },

        greaterThanOrEqual(actual, expected) {
            return expectedNode('greater-than-or-equal', actual, expected);
        },

        group(children) {
            return { [compositeGroupIdentity]: true, children };
        },

        hasProperty(actual, key) {
            return { actual, check: 'has-property', key, message, source };
        },

        includes(actual, expected) {
            return expectedNode('includes', actual, expected);
        },

        instanceOf(actual, expected) {
            return { actual, check: 'instance-of', expected, message, source };
        },

        length(actual, expectedLength) {
            return { actual, check: 'length', expectedLength, message, source };
        },

        lessThan(actual, expected) {
            return expectedNode('less-than', actual, expected);
        },

        lessThanOrEqual(actual, expected) {
            return expectedNode('less-than-or-equal', actual, expected);
        },

        match(actual, pattern) {
            return { actual, check: 'match', message, pattern, source };
        },

        membersPartialDeepEqual(actual, expected) {
            return expectedNode('members-partial-deep-equal', actual, expected);
        },

        notDeepEqual(actual, expected) {
            return expectedNode('not-deep-equal', actual, expected);
        },

        notEmpty(actual) {
            return actualNode('not-empty', actual);
        },

        notEqual(actual, expected) {
            return expectedNode('not-equal', actual, expected);
        },

        notMatch(actual, pattern) {
            return { actual, check: 'not-match', message, pattern, source };
        },

        notNull(actual) {
            return actualNode('not-null', actual);
        },

        null(actual) {
            return actualNode('null', actual);
        },

        number(actual) {
            return actualNode('number', actual);
        },

        object(actual) {
            return actualNode('object', actual);
        },

        partialDeepEqual(actual, expected) {
            return expectedNode('partial-deep-equal', actual, expected);
        },

        startsWith(actual, expected) {
            return expectedNode('starts-with', actual, expected);
        },

        string(actual) {
            return actualNode('string', actual);
        },

        true(actual) {
            return actualNode('true', actual);
        },

        undefined(actual) {
            return actualNode('undefined', actual);
        }
    };
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

function ensureAssertionName(name: string): void {
    if (name.trim().length === 0) {
        throw new TypeError('Assertion reference name must not be empty.');
    }
}
