import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { AssertionSource, ResolvableSourceLocation } from '../assertion-node-shape.ts';

export type FailAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly check: 'fail';
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly source: Source;
};

export const failSummaryByCheck = {
    fail: 'Assertion failed.'
} as const;

export function evaluateFail(assertion: FailAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.check, 'pass', false);
}
