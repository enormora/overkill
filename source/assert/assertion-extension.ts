import {
    createCompositeAssertionGroup,
    createCompositeAssertionReferenceRecord,
    createNarrowingCompositeAssertionReferenceRecord,
    isCompositeAssertionGroup,
    type CompositeAssertionGroup,
    type CompositeAssertionReference,
    type CompositeAssertionSummaryContext,
    type AssertCompositeAssertionReturn,
    type NarrowingCompositeAssertionReference,
    type BuiltInAssertAssertionNode,
    type CompositeAssertionChildNode,
    type ForeignAssertionNode,
    type AssertionSource,
    type DeepComparable,
    type InstanceConstructor,
    type NonEmptyReadonlyArray,
    type ResolvableSourceLocation,
    type SynchronousCallback,
    type ThrownMatcher,
    createThrownErrorRecord,
    thrownMatcherChildren
} from '../packages/engine/assertion-protocol.entry-point.ts';

type GroupItem<Source extends AssertionSource> = CompositeAssertionChildNode<Source> | CompositeAssertionGroup<Source>;

type CompositeAssertionSummaryFormatter<Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    ...parameters: Arguments
) => string;

type NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    actual: Actual,
    ...parameters: Arguments
) => string;

type ForeignAssertionNodeInput<Source extends AssertionSource> = {
    readonly label: string;
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly result: ForeignAssertionNode<Source>['result'];
    readonly source: Source;
};

export type CompositeCheckBuilder<Source extends AssertionSource = AssertionSource> = {
    readonly annotated: (message: string) => CompositeCheckBuilder<Source>;
    readonly array: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly arrayContainsPartial: <Actual, Expected>(
        actual: readonly DeepComparable<Actual>[],
        expectedSubset: DeepComparable<Expected>
    ) => BuiltInAssertAssertionNode<Source>;
    readonly between: (actual: number, minimum: number, maximum: number) => BuiltInAssertAssertionNode<Source>;
    readonly boolean: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly deepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expected: DeepComparable<Expected>
    ) => BuiltInAssertAssertionNode<Source>;
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
        children: NonEmptyReadonlyArray<GroupItem<Source>>
    ) => CompositeAssertionGroup<Source>;
    readonly hasProperty: (actual: unknown, key: PropertyKey) => BuiltInAssertAssertionNode<Source>;
    readonly includes: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly instanceOf: (actual: unknown, expected: InstanceConstructor) => BuiltInAssertAssertionNode<Source>;
    readonly length: (actual: unknown, expectedLength: number) => BuiltInAssertAssertionNode<Source>;
    readonly lessThan: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly lessThanOrEqual: (actual: number, expected: number) => BuiltInAssertAssertionNode<Source>;
    readonly match: (actual: string, pattern: RegExp) => BuiltInAssertAssertionNode<Source>;
    readonly membersPartialDeepEqual: <Actual, Expected>(
        actual: readonly DeepComparable<Actual>[],
        expectedMembers: readonly DeepComparable<Expected>[]
    ) => BuiltInAssertAssertionNode<Source>;
    readonly notDeepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expected: DeepComparable<Expected>
    ) => BuiltInAssertAssertionNode<Source>;
    readonly notEmpty: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly notEqual: (actual: unknown, expected: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly notMatch: (actual: string, pattern: RegExp) => BuiltInAssertAssertionNode<Source>;
    readonly notNull: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly null: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly number: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly object: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly partialDeepEqual: <Actual, Expected>(
        actual: DeepComparable<Actual>,
        expectedSubset: DeepComparable<Expected>
    ) => BuiltInAssertAssertionNode<Source>;
    readonly rejects: (
        thunk: () => PromiseLike<unknown>,
        matcher: ThrownMatcher
    ) => Promise<CompositeAssertionGroup<Source>>;
    readonly startsWith: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly string: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly throws: <Body extends () => unknown>(
        body: SynchronousCallback<Body>,
        matcher: ThrownMatcher
    ) => CompositeAssertionGroup<Source>;
    readonly true: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly undefined: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
};

export type CompositeAssertionDefinition<
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
> = {
    readonly assert: (check: CompositeCheckBuilder<'assert'>, ...parameters: Arguments) => Result;
    readonly formatSummary?: CompositeAssertionSummaryFormatter<Arguments>;
    readonly name: string;
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

function createForeignAssertionNode<Source extends AssertionSource>(
    input: ForeignAssertionNodeInput<Source>
): ForeignAssertionNode<Source> {
    return {
        check: 'foreign',
        label: input.label,
        location: input.location,
        message: input.message,
        result: input.result,
        source: input.source,
        summary: input.result.passed
            ? `Expected foreign assertion ${input.label} to pass.`
            : `${input.label}: ${input.result.error.message}`
    };
}

function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

function flattenCompositeGroupItems<Source extends AssertionSource>(
    items: NonEmptyReadonlyArray<GroupItem<Source>>
): NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>> {
    const children = items.flatMap(function toChildren(item) {
        return isCompositeAssertionGroup<Source>(item) ? item.children : [ item ];
    });

    assertNonEmptyItems(children, 'Expected composite assertion group to contain children.');

    return children;
}

export function createCompositeCheckBuilder<Source extends AssertionSource>(
    source: Source,
    message: string | null,
    location: ResolvableSourceLocation
): CompositeCheckBuilder<Source> {
    return {
        annotated(childMessage) {
            return createCompositeCheckBuilder(source, childMessage, location);
        },

        array(actual) {
            return { actual, check: 'array', location, message, source };
        },

        arrayContainsPartial(actual, expected) {
            return { actual, check: 'array-contains-partial', expected, location, message, source };
        },

        between(actual, minimum, maximum) {
            return { actual, check: 'between', location, maximum, message, minimum, source };
        },

        boolean(actual) {
            return { actual, check: 'boolean', location, message, source };
        },

        deepEqual(actual, expected) {
            return { actual, check: 'deep-equal', expected, location, message, source };
        },

        defined(actual) {
            return { actual, check: 'defined', location, message, source };
        },

        empty(actual) {
            return { actual, check: 'empty', location, message, source };
        },

        endsWith(actual, expected) {
            return { actual, check: 'ends-with', expected, location, message, source };
        },

        equal(actual, expected) {
            return { actual, check: 'equal', expected, location, message, source };
        },

        fail() {
            return { check: 'fail', location, message, source };
        },

        false(actual) {
            return { actual, check: 'false', location, message, source };
        },

        async fromRejectable(label, body) {
            try {
                await body();

                return createForeignAssertionNode({
                    label,
                    location,
                    message,
                    result: { passed: true },
                    source
                });
            } catch (error: unknown) {
                return createForeignAssertionNode({
                    label,
                    location,
                    message,
                    result: {
                        error: createThrownErrorRecord(error),
                        passed: false
                    },
                    source
                });
            }
        },

        fromThrowable(label, body) {
            try {
                body();

                return createForeignAssertionNode({
                    label,
                    location,
                    message,
                    result: { passed: true },
                    source
                });
            } catch (error: unknown) {
                return createForeignAssertionNode({
                    label,
                    location,
                    message,
                    result: {
                        error: createThrownErrorRecord(error),
                        passed: false
                    },
                    source
                });
            }
        },

        function(actual) {
            return { actual, check: 'function', location, message, source };
        },

        greaterThan(actual, expected) {
            return { actual, check: 'greater-than', expected, location, message, source };
        },

        greaterThanOrEqual(actual, expected) {
            return { actual, check: 'greater-than-or-equal', expected, location, message, source };
        },

        group(children) {
            return createCompositeAssertionGroup(flattenCompositeGroupItems(children));
        },

        hasProperty(actual, key) {
            return { actual, check: 'has-property', key, location, message, source };
        },

        includes(actual, expected) {
            return { actual, check: 'includes', expected, location, message, source };
        },

        instanceOf(actual, expected) {
            return { actual, check: 'instance-of', expected, location, message, source };
        },

        length(actual, expectedLength) {
            return { actual, check: 'length', expectedLength, location, message, source };
        },

        lessThan(actual, expected) {
            return { actual, check: 'less-than', expected, location, message, source };
        },

        lessThanOrEqual(actual, expected) {
            return { actual, check: 'less-than-or-equal', expected, location, message, source };
        },

        match(actual, pattern) {
            return { actual, check: 'match', location, message, pattern, source };
        },

        membersPartialDeepEqual(actual, expected) {
            return { actual, check: 'members-partial-deep-equal', expected, location, message, source };
        },

        notDeepEqual(actual, expected) {
            return { actual, check: 'not-deep-equal', expected, location, message, source };
        },

        notEmpty(actual) {
            return { actual, check: 'not-empty', location, message, source };
        },

        notEqual(actual, expected) {
            return { actual, check: 'not-equal', expected, location, message, source };
        },

        notMatch(actual, pattern) {
            return { actual, check: 'not-match', location, message, pattern, source };
        },

        notNull(actual) {
            return { actual, check: 'not-null', location, message, source };
        },

        null(actual) {
            return { actual, check: 'null', location, message, source };
        },

        number(actual) {
            return { actual, check: 'number', location, message, source };
        },

        object(actual) {
            return { actual, check: 'object', location, message, source };
        },

        partialDeepEqual(actual, expected) {
            return { actual, check: 'partial-deep-equal', expected, location, message, source };
        },

        async rejects(thunk, matcher) {
            const promise = thunk();

            try {
                const value = await promise;

                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'rejects',
                    location,
                    matcher,
                    message,
                    observation: { status: 'resolved', value },
                    source
                }));
            } catch (error: unknown) {
                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'rejects',
                    location,
                    matcher,
                    message,
                    observation: { status: 'rejected', value: error },
                    source
                }));
            }
        },

        startsWith(actual, expected) {
            return { actual, check: 'starts-with', expected, location, message, source };
        },

        string(actual) {
            return { actual, check: 'string', location, message, source };
        },

        throws(body, matcher) {
            try {
                const value = body();

                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'throws',
                    location,
                    matcher,
                    message,
                    observation: { status: 'returned', value },
                    source
                }));
            } catch (error: unknown) {
                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'throws',
                    location,
                    matcher,
                    message,
                    observation: { status: 'threw', value: error },
                    source
                }));
            }
        },

        true(actual) {
            return { actual, check: 'true', location, message, source };
        },

        undefined(actual) {
            return { actual, check: 'undefined', location, message, source };
        }
    };
}

export function defineCompositeAssertion<
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
>(definition: CompositeAssertionDefinition<Arguments, Result>): CompositeAssertionReference<Arguments, Result> {
    return createCompositeAssertionReferenceRecord({
        formatSummary: definition.formatSummary ?? null,
        kind: 'composite',
        name: definition.name,
        run(input) {
            return definition.assert(
                createCompositeCheckBuilder(input.source, input.message, input.location),
                ...input.parameters
            );
        }
    });
}

export function defineNarrowingCompositeAssertion<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
>(
    definition: NarrowingCompositeAssertionDefinition<Actual, Narrowed, Arguments>
): NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments> {
    return createNarrowingCompositeAssertionReferenceRecord({
        formatSummary: definition.formatSummary ?? null,
        kind: 'narrowing-composite',
        name: definition.name,
        narrows: definition.narrows
    });
}
