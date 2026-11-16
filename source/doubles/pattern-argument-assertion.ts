import { AssertionError } from 'node:assert';
import { argumentsMatch, type ArgumentComparison } from './argument-comparison.ts';
import { isArgumentMatcher } from './argument-matcher.ts';
import type { AssertionCheck, AssertionResult } from './double-usage-contract.ts';
import type { EventRecord } from './double-usage-inspection.ts';

type PatternAssertionInput = {
    readonly check: AssertionCheck;
    readonly records: readonly EventRecord[];
    readonly expected: readonly unknown[];
    readonly comparison: ArgumentComparison;
    readonly negative: boolean;
    readonly label: string;
};

export function patternArgumentAssertion(input: PatternAssertionInput): AssertionResult {
    const { check, records, expected, comparison, negative, label } = input;
    return check.fromThrowable(label, function assertPatternArguments() {
        const matched = records.some(function recordMatches(record) {
            return argumentsMatch(record.arguments, expected, comparison);
        });

        if (matched === negative) {
            throw new AssertionError({
                actual: records.map(function recordArguments(record) {
                    return record.arguments;
                }),
                expected: expected.map(function expectedPattern(value) {
                    return isArgumentMatcher(value) ? value.pattern : value;
                }),
                message: `Expected ${label} ${negative ? 'not ' : ''}to match ${comparison} argument patterns.`,
                operator: negative ? 'notMatchesArguments' : 'matchesArguments'
            });
        }
    });
}
