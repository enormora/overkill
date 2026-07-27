import { deepEqual } from 'fast-equals';
import { assertionSummary } from './assertion-summary.ts';
import { collectionCount } from './collection-count.ts';
import { isPlainObject, partialDeepEqual } from './partial-matching.ts';
import type { AssertionNode, FailedCheck } from './assertions.ts';

type AssertionEvaluation = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly passed: boolean;
    readonly summary: string;
};

type AssertionEvaluator = (assertion: AssertionNode) => AssertionEvaluation | null;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isSupportedObject(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function evaluated(assertion: AssertionNode, actual: unknown, expected: unknown, passed: boolean): AssertionEvaluation {
    return {
        actual,
        expected,
        passed,
        summary: assertionSummary(assertion)
    };
}

function evaluateArray(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'array'
        ? evaluated(assertion, assertion.actual, 'array', Array.isArray(assertion.actual))
        : null;
}

function evaluateArrayContainsPartial(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'array-contains-partial') {
        return null;
    }

    if (!Array.isArray(assertion.actual)) {
        return evaluated(assertion, assertion.actual, assertion.expected, false);
    }

    const passed = assertion.actual.some(function itemMatches(item) {
        return partialDeepEqual(item, assertion.expected);
    });

    return evaluated(assertion, assertion.actual, assertion.expected, passed);
}

function evaluateBetween(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'between') {
        return null;
    }

    const expected = `${assertion.minimum}..${assertion.maximum}`;
    const passed = isFiniteNumber(assertion.actual) &&
        assertion.actual >= assertion.minimum &&
        assertion.actual <= assertion.maximum;

    return evaluated(assertion, assertion.actual, expected, passed);
}

function evaluateBoolean(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'boolean'
        ? evaluated(assertion, assertion.actual, 'boolean', typeof assertion.actual === 'boolean')
        : null;
}

function evaluateDeepEqual(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'deep-equal'
        ? evaluated(assertion, assertion.actual, assertion.expected, deepEqual(assertion.actual, assertion.expected))
        : null;
}

function evaluateDefined(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'defined'
        ? evaluated(
            assertion,
            assertion.actual,
            'non-nullish value',
            assertion.actual !== null && assertion.actual !== undefined
        )
        : null;
}

function evaluateEmpty(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'empty') {
        return null;
    }

    const count = collectionCount(assertion.actual, 1);

    return evaluated(
        assertion,
        count.supported ? count.count : assertion.actual,
        0,
        count.supported && count.count === 0
    );
}

function evaluateEndsWith(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'ends-with') {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.endsWith(assertion.expected);

    return evaluated(assertion, assertion.actual, assertion.expected, passed);
}

function evaluateEqual(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'equal'
        ? evaluated(assertion, assertion.actual, assertion.expected, Object.is(assertion.actual, assertion.expected))
        : null;
}

function evaluateFail(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'fail' ? evaluated(assertion, 'fail', 'pass', false) : null;
}

function evaluateFalse(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'false'
        ? evaluated(assertion, assertion.actual, false, assertion.actual === false)
        : null;
}

function evaluateFunction(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'function'
        ? evaluated(assertion, assertion.actual, 'function', typeof assertion.actual === 'function')
        : null;
}

function evaluateGreaterThan(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'greater-than') {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual > assertion.expected;

    return evaluated(assertion, assertion.actual, `> ${assertion.expected}`, passed);
}

function evaluateGreaterThanOrEqual(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'greater-than-or-equal') {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual >= assertion.expected;

    return evaluated(assertion, assertion.actual, `>= ${assertion.expected}`, passed);
}

function evaluateHasProperty(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'has-property'
        ? evaluated(
            assertion,
            assertion.actual,
            `own property ${String(assertion.key)}`,
            isSupportedObject(assertion.actual) && Object.hasOwn(assertion.actual, assertion.key)
        )
        : null;
}

function evaluateIncludes(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'includes') {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.includes(assertion.expected);

    return evaluated(assertion, assertion.actual, assertion.expected, passed);
}

function evaluateInstanceOf(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'instance-of'
        ? evaluated(assertion, assertion.actual, assertion.expected, assertion.actual instanceof assertion.expected)
        : null;
}

function evaluateLength(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'length') {
        return null;
    }

    const count = collectionCount(assertion.actual, assertion.expectedLength + 1);
    const validLength = Number.isSafeInteger(assertion.expectedLength) && assertion.expectedLength >= 0;

    return evaluated(
        assertion,
        count.supported ? count.count : assertion.actual,
        assertion.expectedLength,
        validLength && count.supported && count.count === assertion.expectedLength
    );
}

function evaluateLessThan(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'less-than') {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual < assertion.expected;

    return evaluated(assertion, assertion.actual, `< ${assertion.expected}`, passed);
}

function evaluateLessThanOrEqual(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'less-than-or-equal') {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual <= assertion.expected;

    return evaluated(assertion, assertion.actual, `<= ${assertion.expected}`, passed);
}

function evaluateMatch(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'match'
        ? evaluated(
            assertion,
            assertion.actual,
            assertion.pattern,
            typeof assertion.actual === 'string' && assertion.pattern.test(assertion.actual)
        )
        : null;
}

function evaluateMembersPartialDeepEqual(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'members-partial-deep-equal') {
        return null;
    }

    if (!Array.isArray(assertion.actual) || !Array.isArray(assertion.expected)) {
        return evaluated(assertion, assertion.actual, assertion.expected, false);
    }

    const actualMembers = assertion.actual;
    const expectedMembers = assertion.expected;
    const passed = expectedMembers.every(function memberMatches(member) {
        return actualMembers.some(function itemMatches(item) {
            return partialDeepEqual(item, member);
        });
    });

    return evaluated(assertion, assertion.actual, assertion.expected, passed);
}

function evaluateNotDeepEqual(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'not-deep-equal'
        ? evaluated(assertion, assertion.actual, assertion.expected, !deepEqual(assertion.actual, assertion.expected))
        : null;
}

function evaluateNotEmpty(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'not-empty') {
        return null;
    }

    const count = collectionCount(assertion.actual, 1);

    return evaluated(
        assertion,
        count.supported ? count.count : assertion.actual,
        'more than 0',
        count.supported && count.count > 0
    );
}

function evaluateNotEqual(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'not-equal'
        ? evaluated(assertion, assertion.actual, assertion.expected, !Object.is(assertion.actual, assertion.expected))
        : null;
}

function evaluateNotMatch(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'not-match'
        ? evaluated(
            assertion,
            assertion.actual,
            assertion.pattern,
            typeof assertion.actual === 'string' && !assertion.pattern.test(assertion.actual)
        )
        : null;
}

function evaluateNotNull(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'not-null'
        ? evaluated(assertion, assertion.actual, 'not null', assertion.actual !== null)
        : null;
}

function evaluateNull(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'null' ? evaluated(assertion, assertion.actual, null, assertion.actual === null) : null;
}

function evaluateNumber(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'number'
        ? evaluated(assertion, assertion.actual, 'finite number', isFiniteNumber(assertion.actual))
        : null;
}

function evaluateObject(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'object'
        ? evaluated(assertion, assertion.actual, 'plain object', isPlainObject(assertion.actual))
        : null;
}

function evaluatePartialDeepEqual(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'partial-deep-equal'
        ? evaluated(
            assertion,
            assertion.actual,
            assertion.expected,
            partialDeepEqual(assertion.actual, assertion.expected)
        )
        : null;
}

function evaluateStartsWith(assertion: AssertionNode): AssertionEvaluation | null {
    if (assertion.check !== 'starts-with') {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.startsWith(assertion.expected);

    return evaluated(assertion, assertion.actual, assertion.expected, passed);
}

function evaluateString(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'string'
        ? evaluated(assertion, assertion.actual, 'string', typeof assertion.actual === 'string')
        : null;
}

function evaluateTrue(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'true' ? evaluated(assertion, assertion.actual, true, assertion.actual === true) : null;
}

function evaluateUndefined(assertion: AssertionNode): AssertionEvaluation | null {
    return assertion.check === 'undefined'
        ? evaluated(assertion, assertion.actual, undefined, assertion.actual === undefined)
        : null;
}

const assertionEvaluators: readonly AssertionEvaluator[] = [
    evaluateArray,
    evaluateArrayContainsPartial,
    evaluateBetween,
    evaluateBoolean,
    evaluateDeepEqual,
    evaluateDefined,
    evaluateEmpty,
    evaluateEndsWith,
    evaluateEqual,
    evaluateFail,
    evaluateFalse,
    evaluateFunction,
    evaluateGreaterThan,
    evaluateGreaterThanOrEqual,
    evaluateHasProperty,
    evaluateIncludes,
    evaluateInstanceOf,
    evaluateLength,
    evaluateLessThan,
    evaluateLessThanOrEqual,
    evaluateMatch,
    evaluateMembersPartialDeepEqual,
    evaluateNotDeepEqual,
    evaluateNotEmpty,
    evaluateNotEqual,
    evaluateNotMatch,
    evaluateNotNull,
    evaluateNull,
    evaluateNumber,
    evaluateObject,
    evaluatePartialDeepEqual,
    evaluateStartsWith,
    evaluateString,
    evaluateTrue,
    evaluateUndefined
];

function evaluate(assertion: AssertionNode): AssertionEvaluation | null {
    for (const evaluateAssertionNode of assertionEvaluators) {
        const evaluation = evaluateAssertionNode(assertion);

        if (evaluation !== null) {
            return evaluation;
        }
    }

    return null;
}

export function evaluateAssertion(assertion: AssertionNode, id: number): FailedCheck | null {
    const evaluation = evaluate(assertion);

    if (evaluation === null || evaluation.passed) {
        return null;
    }

    return {
        actual: evaluation.actual,
        expected: evaluation.expected,
        id: String(id),
        location: { column: null, file: '', line: null },
        path: [],
        source: assertion.source,
        summary: evaluation.summary
    };
}

export function assertionPasses(assertion: AssertionNode): boolean {
    return evaluateAssertion(assertion, 1) === null;
}
