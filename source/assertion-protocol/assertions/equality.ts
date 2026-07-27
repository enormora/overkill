import { deepEqual } from 'fast-equals';
import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type AssertionCandidate,
    type AssertionSource,
    type ExpectedAssertionNode
} from '../assertion-node-shape.ts';

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

export function evaluateDeepEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<DeepEqualAssertionNode>(assertion, 'deep-equal')
        ? assertionOutcome(assertion.actual, assertion.expected, deepEqual(assertion.actual, assertion.expected))
        : null;
}

export function evaluateEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<EqualAssertionNode>(assertion, 'equal')
        ? assertionOutcome(assertion.actual, assertion.expected, Object.is(assertion.actual, assertion.expected))
        : null;
}

export function evaluateNotDeepEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<NotDeepEqualAssertionNode>(assertion, 'not-deep-equal')
        ? assertionOutcome(assertion.actual, assertion.expected, !deepEqual(assertion.actual, assertion.expected))
        : null;
}

export function evaluateNotEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<NotEqualAssertionNode>(assertion, 'not-equal')
        ? assertionOutcome(assertion.actual, assertion.expected, !Object.is(assertion.actual, assertion.expected))
        : null;
}
