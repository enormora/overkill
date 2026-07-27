import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import { hasAssertionCheck, type AssertionCandidate, type AssertionSource } from '../assertion-node-shape.ts';

export type FailAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly check: 'fail';
    readonly message: string | null;
    readonly source: Source;
};

export const failSummaryByCheck = {
    fail: 'Assertion failed.'
} as const;

export function evaluateFail(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<FailAssertionNode>(assertion, 'fail') ? assertionOutcome('fail', 'pass', false) : null;
}
