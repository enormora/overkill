import {
    type AssertAssertionNode,
    type CompositeAssertionChildNode,
    type CompositeAssertionNode,
    type RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import {
    createCompositeCheckBuilder,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference,
    type AssertReferenceArguments,
    type AssertReferenceReturn,
    type CompositeAssertionReference,
    type CompositeAssertionReturn,
    type NarrowingCompositeAssertionReference
} from '../assertion-protocol/assertion-reference.ts';
import type { AssertionOptions, InstanceConstructor } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestContractFailure } from './run-result.ts';

export type AssertAssertionFacade = {
    <Reference>(
        reference: Reference,
        ...arguments_: AssertReferenceArguments<Reference>
    ): AssertReferenceReturn<Reference>;
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
    <Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...arguments_: Arguments
    ): asserts actual is Narrowed;
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

export type PendingAssertAssertionSink = {
    readonly resolve: (assertion: AssertAssertionNode) => void;
};

export type AssertAssertionSink = {
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingAssertAssertionSink;
};

export type RequireAssertionSink = {
    readonly failContract: (failure: TestContractFailure) => never;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
};

type AssertAssertionMethods = Pick<AssertAssertionFacade, keyof AssertAssertionFacade>;
type RequireAssertionMethods = Pick<RequireAssertionFacade, keyof RequireAssertionFacade>;

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

function createInvalidAssertionReferenceFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-assertion-reference',
        expected: 'engine-created assertion reference',
        kind: 'test-contract',
        summary: 'Expected an engine-created assertion reference.'
    };
}

function createInvalidRequireReferenceFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-require-reference',
        expected: 'narrowing assertion reference',
        kind: 'test-contract',
        summary: 'Expected a narrowing assertion reference.'
    };
}

function createInvalidCompositeResultFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-composite-result',
        expected: 'composite assertion child or group',
        kind: 'test-contract',
        summary: 'Composite assertion returned an invalid result.'
    };
}

function isPromiseLike<Source extends 'assert' | 'require'>(
    value: CompositeAssertionReturn<Source> | Promise<CompositeAssertionReturn<Source>>
): value is Promise<CompositeAssertionReturn<Source>> {
    return typeof value === 'object'
        && value !== null
        && 'then' in value
        && typeof value.then === 'function';
}

function assertionArguments(arguments_: readonly unknown[]): readonly [unknown, unknown] {
    return [
        arguments_[0],
        arguments_.length >= 2 ? arguments_[1] : undefined
    ];
}

function defaultCustomSummary(name: string): string {
    return `Expected ${name} assertion to pass.`;
}

function customSummary(
    reference: { readonly formatSummary: unknown; readonly name: string; },
    source: 'assert' | 'require',
    annotation: string | null,
    arguments_: readonly unknown[]
): string {
    if (annotation !== null) {
        return annotation;
    }

    if (reference.formatSummary !== null) {
        const formatSummary = reference.formatSummary as (
            context: { readonly name: string; readonly source: 'assert' | 'require'; },
            ...summaryArguments: unknown[]
        ) => string;

        return formatSummary({ name: reference.name, source }, ...Array.from(arguments_));
    }

    return defaultCustomSummary(reference.name);
}

function normalizeCompositeChildren<Source extends 'assert' | 'require'>(
    result: CompositeAssertionReturn<Source>,
    failContract: (failure: TestContractFailure) => never
): readonly [CompositeAssertionChildNode<Source>, ...(readonly CompositeAssertionChildNode<Source>[])] {
    if (isCompositeAssertionGroup(result)) {
        return result.children;
    }

    if (typeof result === 'object' && result !== null && 'check' in result) {
        return [ result ];
    }

    failContract(createInvalidCompositeResultFailure(result));
}

function createCompositeAssertionNode<Source extends 'assert' | 'require'>(
    source: Source,
    annotation: string | null,
    reference: { readonly formatSummary: unknown; readonly name: string; },
    arguments_: readonly unknown[],
    children: readonly [CompositeAssertionChildNode<Source>, ...(readonly CompositeAssertionChildNode<Source>[])]
): CompositeAssertionNode<Source> {
    const [ actual, expectedArgument ] = assertionArguments(arguments_);

    return {
        actual,
        check: 'composite',
        children,
        expected: expectedArgument ?? reference.name,
        message: annotation,
        name: reference.name,
        source,
        summary: customSummary(reference, source, annotation, arguments_)
    };
}

function createNarrowingCompositeAssertionNode<Source extends 'assert' | 'require'>(
    source: Source,
    annotation: string | null,
    reference: NarrowingCompositeAssertionReference,
    arguments_: readonly unknown[]
): CompositeAssertionNode<Source> {
    const passed = reference.narrows(arguments_[0], ...arguments_.slice(1));
    const child = createCompositeCheckBuilder(source, `Expected ${reference.name} narrowing predicate to pass.`)
        .true(passed);

    return createCompositeAssertionNode(source, annotation, reference, arguments_, [ child ]);
}

function recordCompositeAssertion(
    sink: AssertAssertionSink,
    annotation: string | null,
    reference: CompositeAssertionReference,
    arguments_: readonly unknown[]
): void | Promise<void> {
    const result = reference.assert(createCompositeCheckBuilder('assert', null), ...arguments_);

    if (!isPromiseLike(result)) {
        sink.recordAssert(createCompositeAssertionNode(
            'assert',
            annotation,
            reference,
            arguments_,
            normalizeCompositeChildren(result, sink.failContract)
        ));
        return undefined;
    }

    const pending = sink.recordPendingAssert();

    return result.then(function recordResolvedComposite(resolved) {
        pending.resolve(createCompositeAssertionNode(
            'assert',
            annotation,
            reference,
            arguments_,
            normalizeCompositeChildren(resolved, sink.failContract)
        ));
    });
}

function recordAssertReference(
    sink: AssertAssertionSink,
    annotation: string | null,
    reference: unknown,
    arguments_: readonly unknown[]
): void | Promise<void> {
    if (!isAssertionReference(reference)) {
        sink.failContract(createInvalidAssertionReferenceFailure(reference));
    }

    if (reference.kind === 'narrowing-composite') {
        sink.recordAssert(createNarrowingCompositeAssertionNode(
            'assert',
            annotation,
            reference as NarrowingCompositeAssertionReference,
            arguments_
        ));
        return undefined;
    }

    return recordCompositeAssertion(sink, annotation, reference as CompositeAssertionReference, arguments_);
}

function recordRequireReference(
    sink: RequireAssertionSink,
    annotation: string | null,
    reference: unknown,
    arguments_: readonly unknown[]
): void {
    if (!isNarrowingAssertionReference(reference)) {
        sink.failContract(isAssertionReference(reference)
            ? createInvalidRequireReferenceFailure(reference.name)
            : createInvalidAssertionReferenceFailure(reference));
    }

    sink.recordRequire(createNarrowingCompositeAssertionNode('require', annotation, reference, arguments_));
}

function createCallableFacade<Facade extends object>(
    methods: object,
    callAssertion: (reference: unknown, arguments_: readonly unknown[]) => unknown
): Facade {
    const callable = function assertionReferenceCall(reference: unknown, ...arguments_: readonly unknown[]): unknown {
        return callAssertion(reference, arguments_);
    };

    return new Proxy(callable, {
        get(target, property, receiver) {
            if (property in methods) {
                return methods[property as keyof typeof methods];
            }

            return Reflect.get(target, property, receiver);
        }
    }) as unknown as Facade;
}

export function createRecordingAssertFacade(
    sink: AssertAssertionSink,
    annotation: string | null
): AssertAssertionFacade {
    const methods: AssertAssertionMethods = {
        annotated(message) {
            return createRecordingAssertFacade(sink, message);
        },

        array(actual, options) {
            sink.recordAssert({ actual, check: 'array', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        arrayContainsPartial(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'array-contains-partial',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        between(actual, minimum, maximum, options) {
            sink.recordAssert({
                actual,
                check: 'between',
                maximum,
                message: messageFromOptions(options, annotation),
                minimum,
                source: 'assert'
            });
        },

        boolean(actual, options) {
            sink.recordAssert({ actual, check: 'boolean', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        deepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        defined(actual, options) {
            sink.recordAssert({ actual, check: 'defined', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        empty(actual, options) {
            sink.recordAssert({ actual, check: 'empty', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        endsWith(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'ends-with',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        equal(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        fail(options) {
            sink.recordAssert({ check: 'fail', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        false(actual, options) {
            sink.recordAssert({ actual, check: 'false', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        function(actual, options) {
            sink.recordAssert({ actual, check: 'function', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        greaterThan(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'greater-than',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        greaterThanOrEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'greater-than-or-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        hasProperty(actual, key, options) {
            sink.recordAssert({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        includes(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'includes',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        instanceOf(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        length(actual, expectedLength, options) {
            sink.recordAssert({
                actual,
                check: 'length',
                expectedLength,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        lessThan(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'less-than',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        lessThanOrEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'less-than-or-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        match(actual, pattern, options) {
            sink.recordAssert({
                actual,
                check: 'match',
                message: messageFromOptions(options, annotation),
                pattern,
                source: 'assert'
            });
        },

        membersPartialDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'members-partial-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'not-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notEmpty(actual, options) {
            sink.recordAssert({ actual, check: 'not-empty', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        notEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'not-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notMatch(actual, pattern, options) {
            sink.recordAssert({
                actual,
                check: 'not-match',
                message: messageFromOptions(options, annotation),
                pattern,
                source: 'assert'
            });
        },

        notNull(actual, options) {
            sink.recordAssert({ actual, check: 'not-null', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        null(actual, options) {
            sink.recordAssert({ actual, check: 'null', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        number(actual, options) {
            sink.recordAssert({ actual, check: 'number', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        object(actual, options) {
            sink.recordAssert({ actual, check: 'object', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        partialDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'partial-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        startsWith(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'starts-with',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        string(actual, options) {
            sink.recordAssert({ actual, check: 'string', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        true(actual, options) {
            sink.recordAssert({ actual, check: 'true', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        undefined(actual, options) {
            sink.recordAssert({ actual, check: 'undefined', message: messageFromOptions(options, annotation), source: 'assert' });
        }
    };

    return createCallableFacade<AssertAssertionFacade>(methods, function callAssertReference(reference, arguments_) {
        return recordAssertReference(sink, annotation, reference, arguments_);
    });
}

export function createRecordingRequireFacade(
    sink: RequireAssertionSink,
    annotation: string | null
): RequireAssertionFacade {
    const methods: RequireAssertionMethods = {
        annotated(message) {
            return createRecordingRequireFacade(sink, message);
        },

        array(actual, options) {
            sink.recordRequire({ actual, check: 'array', message: messageFromOptions(options, annotation), source: 'require' });
        },

        boolean(actual, options) {
            sink.recordRequire({ actual, check: 'boolean', message: messageFromOptions(options, annotation), source: 'require' });
        },

        defined(actual, options) {
            sink.recordRequire({ actual, check: 'defined', message: messageFromOptions(options, annotation), source: 'require' });
        },

        function(actual, options) {
            sink.recordRequire({ actual, check: 'function', message: messageFromOptions(options, annotation), source: 'require' });
        },

        hasProperty(actual, key, options) {
            sink.recordRequire({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        instanceOf(actual, expected: InstanceConstructor, options) {
            sink.recordRequire({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        notNull(actual, options) {
            sink.recordRequire({ actual, check: 'not-null', message: messageFromOptions(options, annotation), source: 'require' });
        },

        null(actual, options) {
            sink.recordRequire({ actual, check: 'null', message: messageFromOptions(options, annotation), source: 'require' });
        },

        number(actual, options) {
            sink.recordRequire({ actual, check: 'number', message: messageFromOptions(options, annotation), source: 'require' });
        },

        object(actual, options) {
            sink.recordRequire({ actual, check: 'object', message: messageFromOptions(options, annotation), source: 'require' });
        },

        string(actual, options) {
            sink.recordRequire({ actual, check: 'string', message: messageFromOptions(options, annotation), source: 'require' });
        }
    };

    return createCallableFacade<RequireAssertionFacade>(methods, function callRequireReference(reference, arguments_) {
        recordRequireReference(sink, annotation, reference, arguments_);
    });
}
