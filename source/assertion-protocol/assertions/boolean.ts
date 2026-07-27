import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type ActualAssertionNode,
    type AssertionCandidate,
    type AssertionSource
} from '../assertion-node-shape.ts';

export type TrueAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'true'>;

export type FalseAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'false'>;

export const booleanSummaryByCheck = {
    false: 'Expected value to be false.',
    true: 'Expected value to be true.'
} as const;

export function evaluateFalse(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<FalseAssertionNode>(assertion, 'false')
        ? assertionOutcome(assertion.actual, false, assertion.actual === false)
        : null;
}

export function evaluateTrue(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TrueAssertionNode>(assertion, 'true')
        ? assertionOutcome(assertion.actual, true, assertion.actual === true)
        : null;
}
