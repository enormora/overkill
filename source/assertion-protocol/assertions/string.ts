import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type AssertionCandidate,
    type AssertionSource,
    type ExpectedAssertionNode
} from '../assertion-node-shape.ts';

export type MatchAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'match' | 'not-match';
    readonly message: string | null;
    readonly pattern: RegExp;
    readonly source: Source;
};

export type StringContainsAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'ends-with' | 'includes' | 'starts-with'
>;

export const stringSummaryByCheck = {
    'ends-with': 'Expected string to end with the value.',
    includes: 'Expected string to include the value.',
    match: 'Expected string to match the pattern.',
    'not-match': 'Expected string not to match the pattern.',
    'starts-with': 'Expected string to start with the value.'
} as const;

export function evaluateEndsWith(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<StringContainsAssertionNode>(assertion, 'ends-with')) {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.endsWith(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluateIncludes(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<StringContainsAssertionNode>(assertion, 'includes')) {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.includes(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluateMatch(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<MatchAssertionNode>(assertion, 'match')
        ? assertionOutcome(
            assertion.actual,
            assertion.pattern,
            typeof assertion.actual === 'string' && assertion.pattern.test(assertion.actual)
        )
        : null;
}

export function evaluateNotMatch(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<MatchAssertionNode>(assertion, 'not-match')
        ? assertionOutcome(
            assertion.actual,
            assertion.pattern,
            typeof assertion.actual === 'string' && !assertion.pattern.test(assertion.actual)
        )
        : null;
}

export function evaluateStartsWith(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<StringContainsAssertionNode>(assertion, 'starts-with')) {
        return null;
    }

    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.startsWith(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}
