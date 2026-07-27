import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type ActualAssertionNode,
    type AssertionCandidate,
    type AssertionSource
} from '../assertion-node-shape.ts';

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

export function evaluateDefined(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<DefinedAssertionNode>(assertion, 'defined')
        ? assertionOutcome(
            assertion.actual,
            'non-nullish value',
            assertion.actual !== null && assertion.actual !== undefined
        )
        : null;
}

export function evaluateNotNull(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<NotNullAssertionNode>(assertion, 'not-null')
        ? assertionOutcome(assertion.actual, 'not null', assertion.actual !== null)
        : null;
}

export function evaluateNull(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<NullAssertionNode>(assertion, 'null')
        ? assertionOutcome(assertion.actual, null, assertion.actual === null)
        : null;
}

export function evaluateUndefined(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<UndefinedAssertionNode>(assertion, 'undefined')
        ? assertionOutcome(assertion.actual, undefined, assertion.actual === undefined)
        : null;
}
