import type {
    CompositeAssertionReference,
    CompositeAssertionReturn,
    NarrowingCompositeAssertionReference
} from '../assertion-protocol/assertion-reference.ts';
import type { AssertionOptions, InstanceConstructor } from '../assertion-protocol/assertion-node-shape.ts';
import {
    recordAssertReference,
    type AssertAssertionSink
} from './custom-assertion-recording.ts';

export type AssertAssertionFacade = {
    <Arguments extends readonly unknown[], Result extends Promise<CompositeAssertionReturn<'assert'>>>(
        reference: CompositeAssertionReference<Arguments, Result>,
        ...parameters: Arguments
    ): Promise<void>;
    <Arguments extends readonly unknown[], Result extends CompositeAssertionReturn<'assert'>>(
        reference: CompositeAssertionReference<Arguments, Result>,
        ...parameters: Arguments
    ): void;
    <Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...parameters: Arguments
    ): void;
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
        ...parameters: Arguments
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

type AssertAssertionMethods = Pick<AssertAssertionFacade, keyof AssertAssertionFacade>;

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

function isAssertMethodName(
    methods: AssertAssertionMethods,
    property: PropertyKey
): property is keyof AssertAssertionMethods {
    return typeof property === 'string' && Object.hasOwn(methods, property);
}

function isAssertAssertionFacade(
    value: unknown,
    methods: AssertAssertionMethods
): value is AssertAssertionFacade {
    return typeof value === 'function' &&
        Object.keys(methods).every(function methodIsAvailable(methodName) {
            return typeof Reflect.get(value, methodName) === 'function';
        });
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
            sink.recordAssert({
                actual,
                check: 'array',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'boolean',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'defined',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        empty(actual, options) {
            sink.recordAssert({
                actual,
                check: 'empty',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'false',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        function(actual, options) {
            sink.recordAssert({
                actual,
                check: 'function',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'not-empty',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'not-null',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        null(actual, options) {
            sink.recordAssert({
                actual,
                check: 'null',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        number(actual, options) {
            sink.recordAssert({
                actual,
                check: 'number',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        object(actual, options) {
            sink.recordAssert({
                actual,
                check: 'object',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
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
            sink.recordAssert({
                actual,
                check: 'string',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        true(actual, options) {
            sink.recordAssert({
                actual,
                check: 'true',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        undefined(actual, options) {
            sink.recordAssert({
                actual,
                check: 'undefined',
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        }
    };

    function callAssertReference<
        Arguments extends readonly unknown[],
        Result extends Promise<CompositeAssertionReturn<'assert'>>
    >(reference: CompositeAssertionReference<Arguments, Result>, ...parameters: Arguments): Promise<void>;
    function callAssertReference<
        Arguments extends readonly unknown[],
        Result extends CompositeAssertionReturn<'assert'>
    >(reference: CompositeAssertionReference<Arguments, Result>, ...parameters: Arguments): void;
    function callAssertReference<Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
        reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>,
        actual: Actual,
        ...parameters: Arguments
    ): void;
    function callAssertReference(reference: unknown, ...parameters: readonly unknown[]): Promise<void> | void {
        return recordAssertReference(sink, annotation, reference, parameters);
    }

    const facade = new Proxy(callAssertReference, {
        get(target, property, receiver): unknown {
            if (isAssertMethodName(methods, property)) {
                return methods[property];
            }

            return Reflect.get(target, property, receiver);
        }
    });

    if (isAssertAssertionFacade(facade, methods)) {
        return facade;
    }

    throw new TypeError('Failed to create assert facade.');
}
