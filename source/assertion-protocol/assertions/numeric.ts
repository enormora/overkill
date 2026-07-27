import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type AssertionCandidate,
    type AssertionSource,
    type ExpectedAssertionNode
} from '../assertion-node-shape.ts';

export type NumericComparisonAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
>;

export type BetweenAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'between';
    readonly maximum: number;
    readonly message: string | null;
    readonly minimum: number;
    readonly source: Source;
};

export const numericSummaryByCheck = {
    between: 'Expected number to be between the bounds.',
    'greater-than': 'Expected number to be greater than the threshold.',
    'greater-than-or-equal': 'Expected number to be greater than or equal to the threshold.',
    'less-than': 'Expected number to be less than the threshold.',
    'less-than-or-equal': 'Expected number to be less than or equal to the threshold.'
} as const;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function evaluateBetween(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<BetweenAssertionNode>(assertion, 'between')) {
        return null;
    }

    const expected = `${assertion.minimum}..${assertion.maximum}`;
    const passed = isFiniteNumber(assertion.actual) &&
        assertion.actual >= assertion.minimum &&
        assertion.actual <= assertion.maximum;

    return assertionOutcome(assertion.actual, expected, passed);
}

export function evaluateGreaterThan(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<NumericComparisonAssertionNode>(assertion, 'greater-than')) {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual > assertion.expected;

    return assertionOutcome(assertion.actual, `> ${assertion.expected}`, passed);
}

export function evaluateGreaterThanOrEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<NumericComparisonAssertionNode>(assertion, 'greater-than-or-equal')) {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual >= assertion.expected;

    return assertionOutcome(assertion.actual, `>= ${assertion.expected}`, passed);
}

export function evaluateLessThan(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<NumericComparisonAssertionNode>(assertion, 'less-than')) {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual < assertion.expected;

    return assertionOutcome(assertion.actual, `< ${assertion.expected}`, passed);
}

export function evaluateLessThanOrEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<NumericComparisonAssertionNode>(assertion, 'less-than-or-equal')) {
        return null;
    }

    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual <= assertion.expected;

    return assertionOutcome(assertion.actual, `<= ${assertion.expected}`, passed);
}
