import type {
    AssertAssertionFacade,
    AssertAssertionNode,
    AssertionOptions,
    InstanceConstructor,
    NonEmptyReadonlyArray,
    RequireAssertionFacade,
    RequireAssertionNode
} from './types.ts';

type AssertRecorder = (assertion: AssertAssertionNode) => void;
type RequireRecorder = (assertion: RequireAssertionNode) => void;

function messageFromOptions(options: AssertionOptions | undefined): string | null {
    return options?.message ?? null;
}

export function createAssertAssertionFacade(
    record: AssertRecorder,
    done: () => NonEmptyReadonlyArray<AssertAssertionNode>
): AssertAssertionFacade {
    return {
        array(actual, options) {
            record({ actual, check: 'array', message: messageFromOptions(options), source: 'assert' });
        },

        arrayContainsPartial(actual, expected, options) {
            record({
                actual,
                check: 'array-contains-partial',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        between(actual, minimum, maximum, options) {
            record({
                actual,
                check: 'between',
                maximum,
                message: messageFromOptions(options),
                minimum,
                source: 'assert'
            });
        },

        boolean(actual, options) {
            record({ actual, check: 'boolean', message: messageFromOptions(options), source: 'assert' });
        },

        deepEqual(actual, expected, options) {
            record({ actual, check: 'deep-equal', expected, message: messageFromOptions(options), source: 'assert' });
        },

        defined(actual, options) {
            record({ actual, check: 'defined', message: messageFromOptions(options), source: 'assert' });
        },

        done,

        empty(actual, options) {
            record({ actual, check: 'empty', message: messageFromOptions(options), source: 'assert' });
        },

        endsWith(actual, expected, options) {
            record({ actual, check: 'ends-with', expected, message: messageFromOptions(options), source: 'assert' });
        },

        equal(actual, expected, options) {
            record({ actual, check: 'equal', expected, message: messageFromOptions(options), source: 'assert' });
        },

        fail(options) {
            record({ check: 'fail', message: messageFromOptions(options), source: 'assert' });
        },

        false(actual, options) {
            record({ actual, check: 'false', message: messageFromOptions(options), source: 'assert' });
        },

        function(actual, options) {
            record({ actual, check: 'function', message: messageFromOptions(options), source: 'assert' });
        },

        greaterThan(actual, expected, options) {
            record({ actual, check: 'greater-than', expected, message: messageFromOptions(options), source: 'assert' });
        },

        greaterThanOrEqual(actual, expected, options) {
            record({
                actual,
                check: 'greater-than-or-equal',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        hasProperty(actual, key, options) {
            record({ actual, check: 'has-property', key, message: messageFromOptions(options), source: 'assert' });
        },

        includes(actual, expected, options) {
            record({ actual, check: 'includes', expected, message: messageFromOptions(options), source: 'assert' });
        },

        instanceOf(actual, expected, options) {
            record({ actual, check: 'instance-of', expected, message: messageFromOptions(options), source: 'assert' });
        },

        length(actual, expectedLength, options) {
            record({ actual, check: 'length', expectedLength, message: messageFromOptions(options), source: 'assert' });
        },

        lessThan(actual, expected, options) {
            record({ actual, check: 'less-than', expected, message: messageFromOptions(options), source: 'assert' });
        },

        lessThanOrEqual(actual, expected, options) {
            record({
                actual,
                check: 'less-than-or-equal',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        match(actual, pattern, options) {
            record({ actual, check: 'match', message: messageFromOptions(options), pattern, source: 'assert' });
        },

        membersPartialDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'members-partial-deep-equal',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        notDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'not-deep-equal',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        notEmpty(actual, options) {
            record({ actual, check: 'not-empty', message: messageFromOptions(options), source: 'assert' });
        },

        notEqual(actual, expected, options) {
            record({ actual, check: 'not-equal', expected, message: messageFromOptions(options), source: 'assert' });
        },

        notMatch(actual, pattern, options) {
            record({ actual, check: 'not-match', message: messageFromOptions(options), pattern, source: 'assert' });
        },

        notNull(actual, options) {
            record({ actual, check: 'not-null', message: messageFromOptions(options), source: 'assert' });
        },

        null(actual, options) {
            record({ actual, check: 'null', message: messageFromOptions(options), source: 'assert' });
        },

        number(actual, options) {
            record({ actual, check: 'number', message: messageFromOptions(options), source: 'assert' });
        },

        object(actual, options) {
            record({ actual, check: 'object', message: messageFromOptions(options), source: 'assert' });
        },

        partialDeepEqual(actual, expected, options) {
            record({
                actual,
                check: 'partial-deep-equal',
                expected,
                message: messageFromOptions(options),
                source: 'assert'
            });
        },

        startsWith(actual, expected, options) {
            record({ actual, check: 'starts-with', expected, message: messageFromOptions(options), source: 'assert' });
        },

        string(actual, options) {
            record({ actual, check: 'string', message: messageFromOptions(options), source: 'assert' });
        },

        true(actual, options) {
            record({ actual, check: 'true', message: messageFromOptions(options), source: 'assert' });
        },

        undefined(actual, options) {
            record({ actual, check: 'undefined', message: messageFromOptions(options), source: 'assert' });
        }
    };
}

export function createRequireAssertionFacade(record: RequireRecorder): RequireAssertionFacade {
    return {
        array(actual, options) {
            record({ actual, check: 'array', message: messageFromOptions(options), source: 'require' });
        },

        boolean(actual, options) {
            record({ actual, check: 'boolean', message: messageFromOptions(options), source: 'require' });
        },

        defined(actual, options) {
            record({ actual, check: 'defined', message: messageFromOptions(options), source: 'require' });
        },

        function(actual, options) {
            record({ actual, check: 'function', message: messageFromOptions(options), source: 'require' });
        },

        hasProperty(actual, key, options) {
            record({ actual, check: 'has-property', key, message: messageFromOptions(options), source: 'require' });
        },

        instanceOf(actual, expected: InstanceConstructor, options) {
            record({ actual, check: 'instance-of', expected, message: messageFromOptions(options), source: 'require' });
        },

        notNull(actual, options) {
            record({ actual, check: 'not-null', message: messageFromOptions(options), source: 'require' });
        },

        null(actual, options) {
            record({ actual, check: 'null', message: messageFromOptions(options), source: 'require' });
        },

        number(actual, options) {
            record({ actual, check: 'number', message: messageFromOptions(options), source: 'require' });
        },

        object(actual, options) {
            record({ actual, check: 'object', message: messageFromOptions(options), source: 'require' });
        },

        string(actual, options) {
            record({ actual, check: 'string', message: messageFromOptions(options), source: 'require' });
        }
    };
}
