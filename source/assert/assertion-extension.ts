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
    type ResolvableSourceLocations,
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
    readonly message: string | null;
    readonly result: ForeignAssertionNode<Source>['result'];
    readonly source: Source;
    readonly sourceLocations: ResolvableSourceLocations;
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
        message: input.message,
        result: input.result,
        source: input.source,
        sourceLocations: input.sourceLocations,
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
    sourceLocations: ResolvableSourceLocations
): CompositeCheckBuilder<Source> {
    return {
        annotated(childMessage) {
            return createCompositeCheckBuilder(source, childMessage, sourceLocations);
        },

        array(actual) {
            return { actual, check: 'array', message, source, sourceLocations };
        },

        arrayContainsPartial(actual, expected) {
            return { actual, check: 'array-contains-partial', expected, message, source, sourceLocations };
        },

        between(actual, minimum, maximum) {
            return { actual, check: 'between', maximum, message, minimum, source, sourceLocations };
        },

        boolean(actual) {
            return { actual, check: 'boolean', message, source, sourceLocations };
        },

        deepEqual(actual, expected) {
            return { actual, check: 'deep-equal', expected, message, source, sourceLocations };
        },

        defined(actual) {
            return { actual, check: 'defined', message, source, sourceLocations };
        },

        empty(actual) {
            return { actual, check: 'empty', message, source, sourceLocations };
        },

        endsWith(actual, expected) {
            return { actual, check: 'ends-with', expected, message, source, sourceLocations };
        },

        equal(actual, expected) {
            return { actual, check: 'equal', expected, message, source, sourceLocations };
        },

        fail() {
            return { check: 'fail', message, source, sourceLocations };
        },

        false(actual) {
            return { actual, check: 'false', message, source, sourceLocations };
        },

        async fromRejectable(label, body) {
            try {
                await body();

                return createForeignAssertionNode({
                    label,
                    message,
                    result: { passed: true },
                    source,
                    sourceLocations
                });
            } catch (error: unknown) {
                return createForeignAssertionNode({
                    label,
                    message,
                    result: {
                        error: createThrownErrorRecord(error),
                        passed: false
                    },
                    source,
                    sourceLocations
                });
            }
        },

        fromThrowable(label, body) {
            try {
                body();

                return createForeignAssertionNode({
                    label,
                    message,
                    result: { passed: true },
                    source,
                    sourceLocations
                });
            } catch (error: unknown) {
                return createForeignAssertionNode({
                    label,
                    message,
                    result: {
                        error: createThrownErrorRecord(error),
                        passed: false
                    },
                    source,
                    sourceLocations
                });
            }
        },

        function(actual) {
            return { actual, check: 'function', message, source, sourceLocations };
        },

        greaterThan(actual, expected) {
            return { actual, check: 'greater-than', expected, message, source, sourceLocations };
        },

        greaterThanOrEqual(actual, expected) {
            return { actual, check: 'greater-than-or-equal', expected, message, source, sourceLocations };
        },

        group(children) {
            return createCompositeAssertionGroup(flattenCompositeGroupItems(children));
        },

        hasProperty(actual, key) {
            return { actual, check: 'has-property', key, message, source, sourceLocations };
        },

        includes(actual, expected) {
            return { actual, check: 'includes', expected, message, source, sourceLocations };
        },

        instanceOf(actual, expected) {
            return { actual, check: 'instance-of', expected, message, source, sourceLocations };
        },

        length(actual, expectedLength) {
            return { actual, check: 'length', expectedLength, message, source, sourceLocations };
        },

        lessThan(actual, expected) {
            return { actual, check: 'less-than', expected, message, source, sourceLocations };
        },

        lessThanOrEqual(actual, expected) {
            return { actual, check: 'less-than-or-equal', expected, message, source, sourceLocations };
        },

        match(actual, pattern) {
            return { actual, check: 'match', message, pattern, source, sourceLocations };
        },

        membersPartialDeepEqual(actual, expected) {
            return { actual, check: 'members-partial-deep-equal', expected, message, source, sourceLocations };
        },

        notDeepEqual(actual, expected) {
            return { actual, check: 'not-deep-equal', expected, message, source, sourceLocations };
        },

        notEmpty(actual) {
            return { actual, check: 'not-empty', message, source, sourceLocations };
        },

        notEqual(actual, expected) {
            return { actual, check: 'not-equal', expected, message, source, sourceLocations };
        },

        notMatch(actual, pattern) {
            return { actual, check: 'not-match', message, pattern, source, sourceLocations };
        },

        notNull(actual) {
            return { actual, check: 'not-null', message, source, sourceLocations };
        },

        null(actual) {
            return { actual, check: 'null', message, source, sourceLocations };
        },

        number(actual) {
            return { actual, check: 'number', message, source, sourceLocations };
        },

        object(actual) {
            return { actual, check: 'object', message, source, sourceLocations };
        },

        partialDeepEqual(actual, expected) {
            return { actual, check: 'partial-deep-equal', expected, message, source, sourceLocations };
        },

        async rejects(thunk, matcher) {
            const promise = thunk();

            try {
                const value = await promise;

                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'rejects',
                    matcher,
                    message,
                    observation: { status: 'resolved', value },
                    source,
                    sourceLocations
                }));
            } catch (error: unknown) {
                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'rejects',
                    matcher,
                    message,
                    observation: { status: 'rejected', value: error },
                    source,
                    sourceLocations
                }));
            }
        },

        startsWith(actual, expected) {
            return { actual, check: 'starts-with', expected, message, source, sourceLocations };
        },

        string(actual) {
            return { actual, check: 'string', message, source, sourceLocations };
        },

        throws(body, matcher) {
            try {
                const value = body();

                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'throws',
                    matcher,
                    message,
                    observation: { status: 'returned', value },
                    source,
                    sourceLocations
                }));
            } catch (error: unknown) {
                return createCompositeAssertionGroup(thrownMatcherChildren({
                    kind: 'throws',
                    matcher,
                    message,
                    observation: { status: 'threw', value: error },
                    source,
                    sourceLocations
                }));
            }
        },

        true(actual) {
            return { actual, check: 'true', message, source, sourceLocations };
        },

        undefined(actual) {
            return { actual, check: 'undefined', message, source, sourceLocations };
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
                createCompositeCheckBuilder(input.source, input.message, input.sourceLocations),
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
