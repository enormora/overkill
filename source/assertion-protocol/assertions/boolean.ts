import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { ActualAssertionNode, AssertionSource } from '../assertion-node-shape.ts';

export type TrueAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'true'>;

export type FalseAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'false'>;

export const booleanSummaryByCheck = {
    false: 'Expected value to be false.',
    true: 'Expected value to be true.'
} as const;

export function evaluateFalse(assertion: FalseAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, false, assertion.actual === false);
}

export function evaluateTrue(assertion: TrueAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, true, assertion.actual === true);
}
