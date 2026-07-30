import type {
    CompositeAssertionChildNode,
    CompositeAssertionNode
} from './assertion-node.ts';
import type {
    AssertionSource,
    InstanceConstructor,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from './assertion-node-shape.ts';

type OptionalFields<Shape, RequiredKey extends keyof Shape> = {
    readonly [ShapeKey in keyof Shape as ShapeKey extends RequiredKey ? never : ShapeKey]?: Shape[ShapeKey];
};

type RequiredField<Shape, RequiredKey extends keyof Shape> = {
    readonly [ShapeKey in RequiredKey]-?: Shape[ShapeKey];
};

type RequireAtLeastOne<Shape, Key extends keyof Shape = keyof Shape> = {
    readonly [RequiredKey in Key]: OptionalFields<Shape, RequiredKey> & RequiredField<Shape, RequiredKey>;
}[Key];

type ErrorConstructor = InstanceConstructor & (abstract new (...args: never[]) => Error);

type ErrorMatcherFields = {
    readonly cause: ThrownMatcher;
    readonly code: string;
    readonly message: RegExp | string;
    readonly name: string;
    readonly type: ErrorConstructor;
};

export type ExactThrownMatcher = {
    readonly cause?: never;
    readonly code?: never;
    readonly exact: unknown;
    readonly message?: never;
    readonly name?: never;
    readonly type?: never;
};

export type ErrorMatcher = RequireAtLeastOne<ErrorMatcherFields> & {
    readonly exact?: never;
};

export type ThrownMatcher = ErrorMatcher | ExactThrownMatcher;

type NonPromise<Body extends () => unknown> = ReturnType<Body> extends PromiseLike<unknown> ? never : Body;

export type SynchronousCallback<Body extends () => unknown> = [ReturnType<Body>] extends [never] ? Body
    : NonPromise<Body>;

type ThrownAssertionKind = 'rejects' | 'throws';

type ObservationStatus = 'rejected' | 'resolved' | 'returned' | 'threw';

export type ThrownAssertionObservation = {
    readonly status: ObservationStatus;
    readonly value: unknown;
};

type ThrownAssertionInput<Source extends AssertionSource> = {
    readonly kind: ThrownAssertionKind;
    readonly location: ResolvableSourceLocation;
    readonly matcher: ThrownMatcher;
    readonly message: string | null;
    readonly observation: ThrownAssertionObservation;
    readonly source: Source;
};

type AssertionChildInput<Source extends AssertionSource, Check extends string> = {
    readonly actual: unknown;
    readonly check: Check;
    readonly location: ResolvableSourceLocation;
    readonly message: string;
    readonly source: Source;
};

type EqualChildInput<Source extends AssertionSource> = AssertionChildInput<Source, 'equal'> & {
    readonly expected: unknown;
};

type InstanceChildInput<Source extends AssertionSource> = AssertionChildInput<Source, 'instance-of'> & {
    readonly expected: InstanceConstructor;
};

type ExpectedChildInput<Source extends AssertionSource> = EqualChildInput<Source> | InstanceChildInput<Source>;

type MatchAssertionChildInput<Source extends AssertionSource> = AssertionChildInput<Source, 'match'> & {
    readonly pattern: RegExp;
};

type MatcherChildrenFactory = <Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ThrownMatcher,
    value: unknown,
    label: string
) => readonly CompositeAssertionChildNode<Source>[];

type MatcherWithField<Key extends keyof ErrorMatcherFields> = ErrorMatcher & RequiredField<ErrorMatcherFields, Key>;

type StructuredMatcherInput<Source extends AssertionSource> = {
    readonly assertion: ThrownAssertionInput<Source>;
    readonly childrenForMatcher: MatcherChildrenFactory;
    readonly label: string;
    readonly matcher: ErrorMatcher;
    readonly value: unknown;
};

type ErrorMatcherInput<Source extends AssertionSource> = StructuredMatcherInput<Source> & {
    readonly value: Error;
};

function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

function isExactThrownMatcher(matcher: ThrownMatcher): matcher is ExactThrownMatcher {
    return Object.hasOwn(matcher, 'exact');
}

function expectedAction(kind: ThrownAssertionKind): string {
    return kind === 'throws' ? 'throw' : 'reject';
}

function missingThrownValueChild<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>
): CompositeAssertionChildNode<Source> {
    return {
        actual: false,
        check: 'true',
        location: input.location,
        message: `Expected function to ${expectedAction(input.kind)}.`,
        source: input.source
    };
}

function expectedMatcherChild<Source extends AssertionSource>(
    input: ExpectedChildInput<Source>
): CompositeAssertionChildNode<Source> {
    if (input.check === 'equal') {
        return {
            actual: input.actual,
            check: input.check,
            expected: input.expected,
            location: input.location,
            message: input.message,
            source: input.source
        };
    }

    return {
        actual: input.actual,
        check: input.check,
        expected: input.expected,
        location: input.location,
        message: input.message,
        source: input.source
    };
}

function matchMatcherChild<Source extends AssertionSource>(
    input: MatchAssertionChildInput<Source>
): CompositeAssertionChildNode<Source> {
    return {
        actual: input.actual,
        check: input.check,
        location: input.location,
        message: input.message,
        pattern: input.pattern,
        source: input.source
    };
}

function errorCode(error: Error): unknown {
    return Reflect.get(error, 'code');
}

function matcherHas<MatcherKey extends keyof ErrorMatcherFields>(
    matcher: ErrorMatcher,
    key: MatcherKey
): matcher is MatcherWithField<MatcherKey> {
    return Object.hasOwn(matcher, key);
}

function errorInstanceChild<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    value: unknown,
    label: string
): CompositeAssertionChildNode<Source> {
    return expectedMatcherChild({
        actual: value,
        check: 'instance-of',
        expected: Error,
        location: input.location,
        message: `Expected ${label} to be an Error.`,
        source: input.source
    });
}

function typeMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ErrorMatcher,
    value: Error,
    label: string
): readonly CompositeAssertionChildNode<Source>[] {
    return matcherHas(matcher, 'type')
        ? [
            expectedMatcherChild({
                actual: value,
                check: 'instance-of',
                expected: matcher.type,
                location: input.location,
                message: `Expected ${label} to be an instance of the constructor.`,
                source: input.source
            })
        ]
        : [];
}

function messageMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ErrorMatcher,
    value: Error,
    label: string
): readonly CompositeAssertionChildNode<Source>[] {
    if (matcherHas(matcher, 'message')) {
        return matcher.message instanceof RegExp
            ? [
                matchMatcherChild({
                    actual: value.message,
                    check: 'match',
                    location: input.location,
                    message: `Expected ${label} message to match the pattern.`,
                    pattern: matcher.message,
                    source: input.source
                })
            ]
            : [
                expectedMatcherChild({
                    actual: value.message,
                    check: 'equal',
                    expected: matcher.message,
                    location: input.location,
                    message: `Expected ${label} message to equal the string.`,
                    source: input.source
                })
            ];
    }

    return [];
}

function codeMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ErrorMatcher,
    value: Error,
    label: string
): readonly CompositeAssertionChildNode<Source>[] {
    return matcherHas(matcher, 'code')
        ? [
            expectedMatcherChild({
                actual: errorCode(value),
                check: 'equal',
                expected: matcher.code,
                location: input.location,
                message: `Expected ${label} code to equal the string.`,
                source: input.source
            })
        ]
        : [];
}

function nameMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ErrorMatcher,
    value: Error,
    label: string
): readonly CompositeAssertionChildNode<Source>[] {
    return matcherHas(matcher, 'name')
        ? [
            expectedMatcherChild({
                actual: value.name,
                check: 'equal',
                expected: matcher.name,
                location: input.location,
                message: `Expected ${label} name to equal the string.`,
                source: input.source
            })
        ]
        : [];
}

function causeMatcherChildren<Source extends AssertionSource>(
    input: ErrorMatcherInput<Source>
): readonly CompositeAssertionChildNode<Source>[] {
    return matcherHas(input.matcher, 'cause')
        ? input.childrenForMatcher(input.assertion, input.matcher.cause, input.value.cause, `${input.label} cause`)
        : [];
}

function structuredErrorChildren<Source extends AssertionSource>(
    input: StructuredMatcherInput<Source>
): readonly CompositeAssertionChildNode<Source>[] {
    if (!(input.value instanceof Error)) {
        return [ errorInstanceChild(input.assertion, input.value, input.label) ];
    }

    const errorInput: ErrorMatcherInput<Source> = {
        ...input,
        value: input.value
    };

    return [
        errorInstanceChild(input.assertion, input.value, input.label),
        ...typeMatcherChildren(input.assertion, input.matcher, input.value, input.label),
        ...messageMatcherChildren(input.assertion, input.matcher, input.value, input.label),
        ...codeMatcherChildren(input.assertion, input.matcher, input.value, input.label),
        ...nameMatcherChildren(input.assertion, input.matcher, input.value, input.label),
        ...causeMatcherChildren(errorInput)
    ];
}

const matcherChildren: MatcherChildrenFactory = function createMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>,
    matcher: ThrownMatcher,
    value: unknown,
    label: string
): readonly CompositeAssertionChildNode<Source>[] {
    return isExactThrownMatcher(matcher)
        ? [
            expectedMatcherChild({
                actual: value,
                check: 'equal',
                expected: matcher.exact,
                location: input.location,
                message: `Expected ${label} to equal the exact matcher.`,
                source: input.source
            })
        ]
        : structuredErrorChildren({
            assertion: input,
            childrenForMatcher: createMatcherChildren,
            label,
            matcher,
            value
        });
};

export function thrownMatcherChildren<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>
): NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>> {
    const expectedStatus = input.kind === 'throws' ? 'threw' : 'rejected';
    const children = input.observation.status === expectedStatus
        ? matcherChildren(input, input.matcher, input.observation.value, 'thrown value')
        : [ missingThrownValueChild(input) ];

    assertNonEmptyItems(children, 'Expected thrown matcher assertion to create children.');

    return children;
}

function thrownMatcherSummary(kind: ThrownAssertionKind): string {
    return `Expected function to ${expectedAction(kind)} matching value.`;
}

export function createThrownMatcherAssertion<Source extends AssertionSource>(
    input: ThrownAssertionInput<Source>
): CompositeAssertionNode<Source> {
    return {
        actual: input.observation,
        check: 'composite',
        children: thrownMatcherChildren(input),
        expected: input.matcher,
        location: input.location,
        message: input.message,
        name: input.kind,
        source: input.source,
        summary: thrownMatcherSummary(input.kind)
    };
}
