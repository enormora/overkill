import { deepEqual } from 'fast-equals';
import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { AssertionSource, ExpectedAssertionNode } from '../assertion-node-shape.ts';

export type EqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'equal'
>;

export type NotEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'not-equal'
>;

export type DeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'deep-equal'
>;

export type NotDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'not-deep-equal'
>;

export const equalitySummaryByCheck = {
    'deep-equal': 'Expected values to be deeply equal.',
    equal: 'Expected values to be equal.',
    'not-deep-equal': 'Expected values not to be deeply equal.',
    'not-equal': 'Expected values not to be equal.'
} as const;

export function evaluateDeepEqual(assertion: DeepEqualAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, assertion.expected, deepEqual(assertion.actual, assertion.expected));
}

export function evaluateEqual(assertion: EqualAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, assertion.expected, Object.is(assertion.actual, assertion.expected));
}

export function evaluateNotDeepEqual(assertion: NotDeepEqualAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, assertion.expected, !deepEqual(assertion.actual, assertion.expected));
}

export function evaluateNotEqual(assertion: NotEqualAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, assertion.expected, !Object.is(assertion.actual, assertion.expected));
}
