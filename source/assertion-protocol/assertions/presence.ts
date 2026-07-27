import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { ActualAssertionNode, AssertionSource } from '../assertion-node-shape.ts';

export type DefinedAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'defined'
>;

export type NullAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<Source, 'null'>;

export type NotNullAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'not-null'
>;

export type UndefinedAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'undefined'
>;

export const presenceSummaryByCheck = {
    defined: 'Expected value to be defined.',
    'not-null': 'Expected value not to be null.',
    null: 'Expected value to be null.',
    undefined: 'Expected value to be undefined.'
} as const;

export function evaluateDefined(assertion: DefinedAssertionNode): AssertionOutcome {
    return assertionOutcome(
        assertion.actual,
        'non-nullish value',
        assertion.actual !== null && assertion.actual !== undefined
    );
}

export function evaluateNotNull(assertion: NotNullAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'not null', assertion.actual !== null);
}

export function evaluateNull(assertion: NullAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, null, assertion.actual === null);
}

export function evaluateUndefined(assertion: UndefinedAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, undefined, assertion.actual === undefined);
}
