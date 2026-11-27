import {
    captureCompositeChild,
    prepareCompositeGroup,
    recordCompositeDiagnostics,
    type CompositeDiagnosticRecording,
    type CompositeAssertionRunnerInput
} from '../assertion-protocol/assertion-reference.ts';
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
    type CheckedThrownMatcher,
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
    isTestControlError,
    observeRejection,
    observeThrow,
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
    readonly rejects: <Matcher extends ThrownMatcher>(
        thunk: () => PromiseLike<unknown>,
        matcher: CheckedThrownMatcher<Matcher>
    ) => Promise<CompositeAssertionGroup<Source>>;
    readonly startsWith: (actual: string, expected: string) => BuiltInAssertAssertionNode<Source>;
    readonly string: (actual: unknown) => BuiltInAssertAssertionNode<Source>;
    readonly throws: <Body extends () => unknown, Matcher extends ThrownMatcher = ThrownMatcher>(
        body: SynchronousCallback<Body>,
        matcher: CheckedThrownMatcher<Matcher>
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

type CaptureCompositeChild = (child: CompositeAssertionChildNode<'assert'>) => void;

function isChildCapture(value: unknown): value is CaptureCompositeChild {
    return typeof value === 'function';
}

type PrepareCompositeGroup = (items: unknown) => NonEmptyReadonlyArray<CompositeAssertionChildNode<'assert'>>;

function isGroupPreparation(value: unknown): value is PrepareCompositeGroup {
    return typeof value === 'function';
}

function isCompositeDiagnosticRecording(value: unknown): value is CompositeDiagnosticRecording {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, 'assertRecording') === 'function' &&
        typeof Reflect.get(value, 'beginAsync') === 'function' &&
        typeof Reflect.get(value, 'group') === 'function';
}

type CompositeCheckHooks<Source extends AssertionSource> = {
    readonly diagnostics: CompositeDiagnosticRecording<Source> | null;
    readonly capture: ((child: CompositeAssertionChildNode<Source>) => void) | null;
    readonly prepareGroup: ((items: unknown) => NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>) | null;
};

function compositeCheckBuilder<Source extends AssertionSource>(
    source: Source,
    message: string | null,
    sourceLocations: ResolvableSourceLocations,
    hooks: CompositeCheckHooks<Source>
): CompositeCheckBuilder<Source> {
    const { diagnostics, capture, prepareGroup } = hooks;
    function group(
        children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>
    ): CompositeAssertionGroup<Source> {
        const result = createCompositeAssertionGroup(children);
        diagnostics?.group(result);
        return result;
    }

    async function asyncCheck<Result>(operation: () => Promise<Result>): Promise<Result> {
        const finish = diagnostics?.beginAsync();
        try {
            return await operation();
        } finally {
            finish?.();
        }
    }

    function child<Node extends CompositeAssertionChildNode<Source>>(node: Node): Node {
        capture?.(node);
        return node;
    }

    return {
        annotated(childMessage) {
            return compositeCheckBuilder(source, childMessage, sourceLocations, hooks);
        },

        array(actual) {
            return child({ actual, check: 'array', message, source, sourceLocations });
        },

        arrayContainsPartial(actual, expected) {
            return child({ actual, check: 'array-contains-partial', expected, message, source, sourceLocations });
        },

        between(actual, minimum, maximum) {
            return child({ actual, check: 'between', maximum, message, minimum, source, sourceLocations });
        },

        boolean(actual) {
            return child({ actual, check: 'boolean', message, source, sourceLocations });
        },

        deepEqual(actual, expected) {
            return child({ actual, check: 'deep-equal', expected, message, source, sourceLocations });
        },

        defined(actual) {
            return child({ actual, check: 'defined', message, source, sourceLocations });
        },

        empty(actual) {
            return child({ actual, check: 'empty', message, source, sourceLocations });
        },

        endsWith(actual, expected) {
            return child({ actual, check: 'ends-with', expected, message, source, sourceLocations });
        },

        equal(actual, expected) {
            return child({ actual, check: 'equal', expected, message, source, sourceLocations });
        },

        fail() {
            return child({ check: 'fail', message, source, sourceLocations });
        },

        false(actual) {
            return child({ actual, check: 'false', message, source, sourceLocations });
        },

        async fromRejectable(label, body) {
            return await asyncCheck(async function observeForeignRejection() {
                let result: ForeignAssertionNode<Source>['result'] = { passed: true };
                try {
                    await body();
                } catch (error: unknown) {
                    if (isTestControlError(error)) {
                        throw error;
                    }
                    result = { error: createThrownErrorRecord(error), passed: false };
                }

                return child(createForeignAssertionNode({ label, message, result, source, sourceLocations }));
            });
        },

        fromThrowable(label, body) {
            diagnostics?.assertRecording('invoke a foreign assertion');
            let result: ForeignAssertionNode<Source>['result'] = { passed: true };
            try {
                body();
            } catch (error: unknown) {
                if (isTestControlError(error)) {
                    throw error;
                }
                result = { error: createThrownErrorRecord(error), passed: false };
            }

            return child(createForeignAssertionNode({ label, message, result, source, sourceLocations }));
        },

        function(actual) {
            return child({ actual, check: 'function', message, source, sourceLocations });
        },

        greaterThan(actual, expected) {
            return child({ actual, check: 'greater-than', expected, message, source, sourceLocations });
        },

        greaterThanOrEqual(actual, expected) {
            return child({ actual, check: 'greater-than-or-equal', expected, message, source, sourceLocations });
        },

        group(children) {
            return group(
                prepareGroup === null ? flattenCompositeGroupItems(children) : prepareGroup(children)
            );
        },

        hasProperty(actual, key) {
            return child({ actual, check: 'has-property', key, message, source, sourceLocations });
        },

        includes(actual, expected) {
            return child({ actual, check: 'includes', expected, message, source, sourceLocations });
        },

        instanceOf(actual, expected) {
            return child({ actual, check: 'instance-of', expected, message, source, sourceLocations });
        },

        length(actual, expectedLength) {
            return child({ actual, check: 'length', expectedLength, message, source, sourceLocations });
        },

        lessThan(actual, expected) {
            return child({ actual, check: 'less-than', expected, message, source, sourceLocations });
        },

        lessThanOrEqual(actual, expected) {
            return child({ actual, check: 'less-than-or-equal', expected, message, source, sourceLocations });
        },

        match(actual, pattern) {
            return child({ actual, check: 'match', message, pattern, source, sourceLocations });
        },

        membersPartialDeepEqual(actual, expected) {
            return child({ actual, check: 'members-partial-deep-equal', expected, message, source, sourceLocations });
        },

        notDeepEqual(actual, expected) {
            return child({ actual, check: 'not-deep-equal', expected, message, source, sourceLocations });
        },

        notEmpty(actual) {
            return child({ actual, check: 'not-empty', message, source, sourceLocations });
        },

        notEqual(actual, expected) {
            return child({ actual, check: 'not-equal', expected, message, source, sourceLocations });
        },

        notMatch(actual, pattern) {
            return child({ actual, check: 'not-match', message, pattern, source, sourceLocations });
        },

        notNull(actual) {
            return child({ actual, check: 'not-null', message, source, sourceLocations });
        },

        null(actual) {
            return child({ actual, check: 'null', message, source, sourceLocations });
        },

        number(actual) {
            return child({ actual, check: 'number', message, source, sourceLocations });
        },

        object(actual) {
            return child({ actual, check: 'object', message, source, sourceLocations });
        },

        partialDeepEqual(actual, expected) {
            return child({ actual, check: 'partial-deep-equal', expected, message, source, sourceLocations });
        },

        async rejects(thunk, matcher) {
            return await asyncCheck(async function observeExpectedRejection() {
                const promise = thunk();

                const observation = await observeRejection(promise);
                if (observation.status === 'rejected' && isTestControlError(observation.value)) {
                    throw observation.value;
                }

                const children = thrownMatcherChildren({
                    kind: 'rejects',
                    matcher,
                    message,
                    observation,
                    source,
                    sourceLocations
                });
                children.forEach(function captureChild(node) {
                    capture?.(node);
                });
                return group(children);
            });
        },

        startsWith(actual, expected) {
            return child({ actual, check: 'starts-with', expected, message, source, sourceLocations });
        },

        string(actual) {
            return child({ actual, check: 'string', message, source, sourceLocations });
        },

        throws(body, matcher) {
            diagnostics?.assertRecording('invoke an error assertion');
            const observation = observeThrow(body);

            const children = thrownMatcherChildren({
                kind: 'throws',
                matcher,
                message,
                observation,
                source,
                sourceLocations
            });
            children.forEach(function captureChild(node) {
                capture?.(node);
            });
            return group(children);
        },

        true(actual) {
            return child({ actual, check: 'true', message, source, sourceLocations });
        },

        undefined(actual) {
            return child({ actual, check: 'undefined', message, source, sourceLocations });
        }
    };
}

export function createCompositeCheckBuilder<Source extends AssertionSource>(
    source: Source,
    message: string | null,
    sourceLocations: ResolvableSourceLocations
): CompositeCheckBuilder<Source> {
    return compositeCheckBuilder(source, message, sourceLocations, {
        diagnostics: null,
        capture: null,
        prepareGroup: null
    });
}

function compositeDiagnosticHooks<Arguments extends readonly unknown[]>(
    input: CompositeAssertionRunnerInput<Arguments, 'assert'>
): CompositeCheckHooks<'assert'> {
    const capture: unknown = Reflect.get(input, captureCompositeChild);
    const diagnostics: unknown = Reflect.get(input, recordCompositeDiagnostics);
    const prepare: unknown = Reflect.get(input, prepareCompositeGroup);
    return {
        diagnostics: isCompositeDiagnosticRecording(diagnostics) ? diagnostics : null,
        capture: isChildCapture(capture) ? capture : null,
        prepareGroup: isGroupPreparation(prepare) ? prepare : null
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
                compositeCheckBuilder(input.source, input.message, input.sourceLocations, compositeDiagnosticHooks(input)),
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
