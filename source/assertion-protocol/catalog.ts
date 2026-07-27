import type {
    AssertAssertionFacade,
    AssertAssertionNode,
    AssertionOptions,
    InstanceConstructor,
    RequireAssertionFacade,
    RequireAssertionNode
} from './assertions.ts';

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
