import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { AssertionSource, ExpectedAssertionNode } from '../assertion-node-shape.ts';

export type MatchAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly [Check in 'match' | 'not-match']: {
        readonly actual: unknown;
        readonly check: Check;
        readonly message: string | null;
        readonly pattern: RegExp;
        readonly source: Source;
    };
}['match' | 'not-match'];

export type StringContainsAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly [Check in 'ends-with' | 'includes' | 'starts-with']: ExpectedAssertionNode<Source, Check>;
}['ends-with' | 'includes' | 'starts-with'];

export const stringSummaryByCheck = {
    'ends-with': 'Expected string to end with the value.',
    includes: 'Expected string to include the value.',
    match: 'Expected string to match the pattern.',
    'not-match': 'Expected string not to match the pattern.',
    'starts-with': 'Expected string to start with the value.'
} as const;

export function evaluateEndsWith(assertion: StringContainsAssertionNode): AssertionOutcome {
    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.endsWith(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluateIncludes(assertion: StringContainsAssertionNode): AssertionOutcome {
    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.includes(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluateMatch(assertion: MatchAssertionNode): AssertionOutcome {
    return assertionOutcome(
        assertion.actual,
        assertion.pattern,
        typeof assertion.actual === 'string' && assertion.pattern.test(assertion.actual)
    );
}

export function evaluateNotMatch(assertion: MatchAssertionNode): AssertionOutcome {
    return assertionOutcome(
        assertion.actual,
        assertion.pattern,
        typeof assertion.actual === 'string' && !assertion.pattern.test(assertion.actual)
    );
}

export function evaluateStartsWith(assertion: StringContainsAssertionNode): AssertionOutcome {
    const passed = typeof assertion.actual === 'string' &&
        typeof assertion.expected === 'string' &&
        assertion.actual.startsWith(assertion.expected);

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}
