import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type AssertionCandidate,
    type AssertionSource,
    type ExpectedAssertionNode
} from '../assertion-node-shape.ts';
import { partialDeepEqual } from '../partial-matching.ts';

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

export function evaluateArrayContainsPartial(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<ArrayContainsPartialAssertionNode>(assertion, 'array-contains-partial')) {
        return null;
    }

    if (!Array.isArray(assertion.actual)) {
        return assertionOutcome(assertion.actual, assertion.expected, false);
    }

    const passed = assertion.actual.some(function itemMatches(item) {
        return partialDeepEqual(item, assertion.expected);
    });

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluateMembersPartialDeepEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<MembersPartialDeepEqualAssertionNode>(assertion, 'members-partial-deep-equal')) {
        return null;
    }

    if (!Array.isArray(assertion.actual) || !Array.isArray(assertion.expected)) {
        return assertionOutcome(assertion.actual, assertion.expected, false);
    }

    const actualMembers = assertion.actual;
    const expectedMembers = assertion.expected;
    const passed = expectedMembers.every(function memberMatches(member) {
        return actualMembers.some(function itemMatches(item) {
            return partialDeepEqual(item, member);
        });
    });

    return assertionOutcome(assertion.actual, assertion.expected, passed);
}

export function evaluatePartialDeepEqual(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<PartialDeepEqualAssertionNode>(assertion, 'partial-deep-equal')
        ? assertionOutcome(
            assertion.actual,
            assertion.expected,
            partialDeepEqual(assertion.actual, assertion.expected)
        )
        : null;
}
