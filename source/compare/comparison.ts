import { createStringHunks } from '../diff/string-diff.ts';
import type { Diff } from '../diff/diff-shape.ts';
import {
    comparisonResult,
    emptyPath,
    failedResult,
    passedResult,
    serializedValueDiff as createSerializedValueDiff,
    valueMismatch,
    type ComparisonResult as StructuredComparisonResult
} from './comparison-result.ts';
import { compareExactly, comparePartially } from './raw-comparison.ts';
import { exactStructuredDiff, partialStructuredDiff } from './structured-diff.ts';
import { serializeValue } from './serialized-value.ts';

export type ComparisonResult = StructuredComparisonResult;

export const serializedValueDiff: (actual: unknown, expected: unknown) => Diff = createSerializedValueDiff;

export function compareEqualValues(actual: unknown, expected: unknown): ComparisonResult {
    return Object.is(actual, expected) ? passedResult(actual, expected) : failedResult(actual, expected, null);
}

export function compareStringEquality(actual: string, expected: string): ComparisonResult {
    if (Object.is(actual, expected)) {
        return passedResult(actual, expected);
    }

    return failedResult(actual, expected, {
        actual,
        expected,
        hunks: createStringHunks(expected, actual),
        kind: 'string'
    });
}

export function compareDeepValues(actual: unknown, expected: unknown): ComparisonResult {
    if (compareExactly(actual, expected)) {
        return passedResult(actual, expected);
    }

    const comparison = exactStructuredDiff(actual, expected);

    return comparison.passed ? valueMismatch(actual, expected) : comparison;
}

export function comparePartialValue(actual: unknown, expected: unknown): ComparisonResult {
    if (comparePartially(actual, expected)) {
        return passedResult(actual, expected);
    }

    const comparison = partialStructuredDiff(actual, expected);

    return comparison.passed ? valueMismatch(actual, expected) : comparison;
}

export function compareArrayContainsPartial(actual: unknown, expected: unknown): ComparisonResult {
    if (!Array.isArray(actual)) {
        return valueMismatch(actual, expected);
    }

    const passed = actual.some(function itemMatches(item) {
        return comparePartially(item, expected);
    });

    return passed
        ? passedResult(actual, expected)
        : failedResult(actual, expected, {
            kind: 'array',
            operations: [
                {
                    operation: 'missing-member',
                    value: serializeValue(expected)
                }
            ]
        });
}

export function compareMembersPartialDeepEqual(actual: unknown, expected: unknown): ComparisonResult {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
        return valueMismatch(actual, expected);
    }

    const missingMembers = expected.filter(function missingMember(expectedMember) {
        return actual.every(function itemMatches(actualMember) {
            return !comparePartially(actualMember, expectedMember);
        });
    });

    return missingMembers.length === 0
        ? passedResult(actual, expected)
        : failedResult(actual, expected, {
            kind: 'array',
            operations: missingMembers.map(function toMissingMember(member) {
                return {
                    operation: 'missing-member',
                    value: serializeValue(member)
                };
            })
        });
}

export function serializedOutcome(actual: unknown, expected: unknown, passed: boolean): ComparisonResult {
    return comparisonResult({ actual, diff: null, expected, passed, path: emptyPath });
}
