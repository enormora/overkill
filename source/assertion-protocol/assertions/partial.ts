import {
    compareArrayContainsPartial,
    compareMembersPartialDeepEqual,
    comparePartialValue
} from '../../compare/comparison.ts';
import { comparisonOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { AssertionSource, ExpectedAssertionNode } from '../assertion-node-shape.ts';

export type PartialDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'partial-deep-equal'
>;

export type ArrayContainsPartialAssertionNode<Source extends AssertionSource = AssertionSource> = ExpectedAssertionNode<
    Source,
    'array-contains-partial'
>;

export type MembersPartialDeepEqualAssertionNode<Source extends AssertionSource = AssertionSource> =
    ExpectedAssertionNode<Source, 'members-partial-deep-equal'>;

export const partialSummaryByCheck = {
    'array-contains-partial': 'Expected array to contain a partial member.',
    'members-partial-deep-equal': 'Expected array to contain the partial members.',
    'partial-deep-equal': 'Expected value to partially match.'
} as const;

export function evaluateArrayContainsPartial(assertion: ArrayContainsPartialAssertionNode): AssertionOutcome {
    return comparisonOutcome(compareArrayContainsPartial(assertion.actual, assertion.expected));
}

export function evaluateMembersPartialDeepEqual(assertion: MembersPartialDeepEqualAssertionNode): AssertionOutcome {
    return comparisonOutcome(compareMembersPartialDeepEqual(assertion.actual, assertion.expected));
}

export function evaluatePartialDeepEqual(assertion: PartialDeepEqualAssertionNode): AssertionOutcome {
    return comparisonOutcome(comparePartialValue(assertion.actual, assertion.expected));
}
