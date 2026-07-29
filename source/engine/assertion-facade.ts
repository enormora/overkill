import type {
    CompositeAssertionReference,
    CompositeAssertionReturn,
    NarrowingCompositeAssertionReference
} from '../assertion-protocol/assertion-reference.ts';
import type {
    AssertionOptions,
    InstanceConstructor,
    ResolvableSourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import { captureSourceLocation } from '../assertion-protocol/source-location.ts';
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

type AssertAssertionMethods = Pick<AssertAssertionFacade, keyof AssertAssertionFacade>;

type AssertAssertionMetadata = {
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: 'assert';
};

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

function assertAssertionMetadata(
    options: AssertionOptions | undefined,
    annotation: string | null,
    captureLocation: () => ResolvableSourceLocation
): AssertAssertionMetadata {
    return {
        location: captureLocation(),
        message: messageFromOptions(options, annotation),
        source: 'assert'
    };
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

export function createRecordingAssertFacadeWithLocation(
    sink: AssertAssertionSink,
    annotation: string | null,
    captureLocation: () => ResolvableSourceLocation
): AssertAssertionFacade {
    const methods: AssertAssertionMethods = {
        annotated(message) {
            return createRecordingAssertFacadeWithLocation(sink, message, captureLocation);
        },

        array(actual, options) {
            sink.recordAssert({
                actual,
                check: 'array',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        arrayContainsPartial(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'array-contains-partial',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        between(actual, minimum, maximum, options) {
            sink.recordAssert({
                actual,
                check: 'between',
                maximum,
                minimum,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        boolean(actual, options) {
            sink.recordAssert({
                actual,
                check: 'boolean',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        deepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'deep-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        defined(actual, options) {
            sink.recordAssert({
                actual,
                check: 'defined',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        empty(actual, options) {
            sink.recordAssert({
                actual,
                check: 'empty',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        endsWith(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'ends-with',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        equal(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        fail(options) {
            sink.recordAssert({
                check: 'fail',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        false(actual, options) {
            sink.recordAssert({
                actual,
                check: 'false',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        function(actual, options) {
            sink.recordAssert({
                actual,
                check: 'function',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        greaterThan(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'greater-than',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        greaterThanOrEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'greater-than-or-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        hasProperty(actual, key, options) {
            sink.recordAssert({
                actual,
                check: 'has-property',
                key,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        includes(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'includes',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        instanceOf(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'instance-of',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        length(actual, expectedLength, options) {
            sink.recordAssert({
                actual,
                check: 'length',
                expectedLength,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        lessThan(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'less-than',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        lessThanOrEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'less-than-or-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        match(actual, pattern, options) {
            sink.recordAssert({
                actual,
                check: 'match',
                pattern,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        membersPartialDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'members-partial-deep-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        notDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'not-deep-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        notEmpty(actual, options) {
            sink.recordAssert({
                actual,
                check: 'not-empty',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        notEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'not-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        notMatch(actual, pattern, options) {
            sink.recordAssert({
                actual,
                check: 'not-match',
                pattern,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        notNull(actual, options) {
            sink.recordAssert({
                actual,
                check: 'not-null',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        null(actual, options) {
            sink.recordAssert({
                actual,
                check: 'null',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        number(actual, options) {
            sink.recordAssert({
                actual,
                check: 'number',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        object(actual, options) {
            sink.recordAssert({
                actual,
                check: 'object',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        partialDeepEqual(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'partial-deep-equal',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        startsWith(actual, expected, options) {
            sink.recordAssert({
                actual,
                check: 'starts-with',
                expected,
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        string(actual, options) {
            sink.recordAssert({
                actual,
                check: 'string',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        true(actual, options) {
            sink.recordAssert({
                actual,
                check: 'true',
                ...assertAssertionMetadata(options, annotation, captureLocation)
            });
        },

        undefined(actual, options) {
            sink.recordAssert({
                actual,
                check: 'undefined',
                ...assertAssertionMetadata(options, annotation, captureLocation)
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
        return recordAssertReference({
            annotation,
            location: captureLocation(),
            parameters,
            reference,
            sink
        });
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

export function createRecordingAssertFacade(
    sink: AssertAssertionSink,
    annotation: string | null
): AssertAssertionFacade {
    return createRecordingAssertFacadeWithLocation(sink, annotation, captureSourceLocation);
}
