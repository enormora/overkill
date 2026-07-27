import type { AssertAssertionNode, RequireAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { AssertionOptions, InstanceConstructor } from '../assertion-protocol/assertion-node-shape.ts';

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

type AssertAssertionSink = (assertion: AssertAssertionNode) => void;
type RequireAssertionSink = (assertion: RequireAssertionNode) => void;

function messageFromOptions(options: AssertionOptions | undefined, annotation: string | null): string | null {
    return options?.message ?? annotation;
}

export function createRecordingAssertFacade(
    record: AssertAssertionSink,
    annotation: string | null
): AssertAssertionFacade {
    return {
        annotated(message) {
            return createRecordingAssertFacade(record, message);
        },

        array(actual, options) {
            record({ actual, check: 'array', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        arrayContainsPartial(actual, expected, options) {
            record({
                actual,
                check: 'array-contains-partial',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        between(actual, minimum, maximum, options) {
            record({
                actual,
                check: 'between',
                maximum,
                message: messageFromOptions(options, annotation),
                minimum,
                source: 'assert'
            });
        },

        boolean(actual, options) {
            record({ actual, check: 'boolean', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        deepEqual(actual, expected, options) {
            record({
                actual,
                check: 'deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        defined(actual, options) {
            record({ actual, check: 'defined', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        empty(actual, options) {
            record({ actual, check: 'empty', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        endsWith(actual, expected, options) {
            record({
                actual,
                check: 'ends-with',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        equal(actual, expected, options) {
            record({
                actual,
                check: 'equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        fail(options) {
            record({ check: 'fail', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        false(actual, options) {
            record({ actual, check: 'false', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        function(actual, options) {
            record({ actual, check: 'function', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        greaterThan(actual, expected, options) {
            record({
                actual,
                check: 'greater-than',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        greaterThanOrEqual(actual, expected, options) {
            record({
                actual,
                check: 'greater-than-or-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        hasProperty(actual, key, options) {
            record({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        includes(actual, expected, options) {
            record({
                actual,
                check: 'includes',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        instanceOf(actual, expected, options) {
            record({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        length(actual, expectedLength, options) {
            record({
                actual,
                check: 'length',
                expectedLength,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        lessThan(actual, expected, options) {
            record({
                actual,
                check: 'less-than',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        lessThanOrEqual(actual, expected, options) {
            record({
                actual,
                check: 'less-than-or-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        match(actual, pattern, options) {
            record({
                actual,
                check: 'match',
                message: messageFromOptions(options, annotation),
                pattern,
                source: 'assert'
            });
        },

        membersPartialDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'members-partial-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'not-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notEmpty(actual, options) {
            record({ actual, check: 'not-empty', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        notEqual(actual, expected, options) {
            record({
                actual,
                check: 'not-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        notMatch(actual, pattern, options) {
            record({
                actual,
                check: 'not-match',
                message: messageFromOptions(options, annotation),
                pattern,
                source: 'assert'
            });
        },

        notNull(actual, options) {
            record({ actual, check: 'not-null', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        null(actual, options) {
            record({ actual, check: 'null', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        number(actual, options) {
            record({ actual, check: 'number', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        object(actual, options) {
            record({ actual, check: 'object', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        partialDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'partial-deep-equal',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        startsWith(actual, expected, options) {
            record({
                actual,
                check: 'starts-with',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'assert'
            });
        },

        string(actual, options) {
            record({ actual, check: 'string', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        true(actual, options) {
            record({ actual, check: 'true', message: messageFromOptions(options, annotation), source: 'assert' });
        },

        undefined(actual, options) {
            record({ actual, check: 'undefined', message: messageFromOptions(options, annotation), source: 'assert' });
        }
    };
}

export function createRecordingRequireFacade(
    record: RequireAssertionSink,
    annotation: string | null
): RequireAssertionFacade {
    return {
        annotated(message) {
            return createRecordingRequireFacade(record, message);
        },

        array(actual, options) {
            record({ actual, check: 'array', message: messageFromOptions(options, annotation), source: 'require' });
        },

        boolean(actual, options) {
            record({ actual, check: 'boolean', message: messageFromOptions(options, annotation), source: 'require' });
        },

        defined(actual, options) {
            record({ actual, check: 'defined', message: messageFromOptions(options, annotation), source: 'require' });
        },

        function(actual, options) {
            record({ actual, check: 'function', message: messageFromOptions(options, annotation), source: 'require' });
        },

        hasProperty(actual, key, options) {
            record({
                actual,
                check: 'has-property',
                key,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        instanceOf(actual, expected: InstanceConstructor, options) {
            record({
                actual,
                check: 'instance-of',
                expected,
                message: messageFromOptions(options, annotation),
                source: 'require'
            });
        },

        notNull(actual, options) {
            record({ actual, check: 'not-null', message: messageFromOptions(options, annotation), source: 'require' });
        },

        null(actual, options) {
            record({ actual, check: 'null', message: messageFromOptions(options, annotation), source: 'require' });
        },

        number(actual, options) {
            record({ actual, check: 'number', message: messageFromOptions(options, annotation), source: 'require' });
        },

        object(actual, options) {
            record({ actual, check: 'object', message: messageFromOptions(options, annotation), source: 'require' });
        },

        string(actual, options) {
            record({ actual, check: 'string', message: messageFromOptions(options, annotation), source: 'require' });
        }
    };
}
