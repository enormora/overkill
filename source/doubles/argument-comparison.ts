import { compareExactly, comparePartially } from '../compare/raw-comparison.ts';
import { isArgumentMatcher } from './argument-matcher.ts';

export type ArgumentComparison = 'exact' | 'partial' | 'prefix';

export function hasArgumentMatchers(expected: readonly unknown[]): boolean {
    return expected.some(isArgumentMatcher);
}

function argumentMatches(actual: unknown, expected: unknown, comparison: ArgumentComparison): boolean {
    if (isArgumentMatcher(expected)) {
        return expected.matches(actual);
    }

    return comparison === 'exact' ? compareExactly(actual, expected) : comparePartially(actual, expected);
}

export function argumentsMatch(
    actual: readonly unknown[],
    expected: readonly unknown[],
    comparison: ArgumentComparison
): boolean {
    if (comparison === 'exact' && !hasArgumentMatchers(expected)) {
        return compareExactly(actual, expected);
    }

    const arityMatches = comparison === 'prefix' ? actual.length >= expected.length : actual.length === expected.length;

    return arityMatches && expected.every(function expectedArgumentMatches(value, index) {
        return argumentMatches(actual[index], value, comparison);
    });
}
