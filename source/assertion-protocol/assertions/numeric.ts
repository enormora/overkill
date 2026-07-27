import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { AssertionSource, ExpectedAssertionNode } from '../assertion-node-shape.ts';

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

export function evaluateBetween(assertion: BetweenAssertionNode): AssertionOutcome {
    const expected = `${assertion.minimum}..${assertion.maximum}`;
    const passed = isFiniteNumber(assertion.actual) &&
        assertion.actual >= assertion.minimum &&
        assertion.actual <= assertion.maximum;

    return assertionOutcome(assertion.actual, expected, passed);
}

export function evaluateGreaterThan(assertion: NumericComparisonAssertionNode): AssertionOutcome {
    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual > assertion.expected;

    return assertionOutcome(assertion.actual, `> ${assertion.expected}`, passed);
}

export function evaluateGreaterThanOrEqual(assertion: NumericComparisonAssertionNode): AssertionOutcome {
    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual >= assertion.expected;

    return assertionOutcome(assertion.actual, `>= ${assertion.expected}`, passed);
}

export function evaluateLessThan(assertion: NumericComparisonAssertionNode): AssertionOutcome {
    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual < assertion.expected;

    return assertionOutcome(assertion.actual, `< ${assertion.expected}`, passed);
}

export function evaluateLessThanOrEqual(assertion: NumericComparisonAssertionNode): AssertionOutcome {
    const passed = isFiniteNumber(assertion.actual) &&
        isFiniteNumber(assertion.expected) &&
        assertion.actual <= assertion.expected;

    return assertionOutcome(assertion.actual, `<= ${assertion.expected}`, passed);
}
