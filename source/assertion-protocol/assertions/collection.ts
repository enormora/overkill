import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type ActualAssertionNode,
    type AssertionCandidate,
    type AssertionSource
} from '../assertion-node-shape.ts';
import { collectionCount } from '../collection-count.ts';

export type LengthAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'length';
    readonly expectedLength: number;
    readonly message: string | null;
    readonly source: Source;
};

export type EmptinessAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'empty' | 'not-empty'
>;

export const collectionSummaryByCheck = {
    empty: 'Expected collection to be empty.',
    length: 'Expected collection length to match.',
    'not-empty': 'Expected collection not to be empty.'
} as const;

export function evaluateEmpty(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<EmptinessAssertionNode>(assertion, 'empty')) {
        return null;
    }

    const count = collectionCount(assertion.actual, 1);

    return assertionOutcome(
        count.supported ? count.count : assertion.actual,
        0,
        count.supported && count.count === 0
    );
}

export function evaluateLength(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<LengthAssertionNode>(assertion, 'length')) {
        return null;
    }

    const count = collectionCount(assertion.actual, assertion.expectedLength + 1);
    const validLength = Number.isSafeInteger(assertion.expectedLength) && assertion.expectedLength >= 0;

    return assertionOutcome(
        count.supported ? count.count : assertion.actual,
        assertion.expectedLength,
        validLength && count.supported && count.count === assertion.expectedLength
    );
}

export function evaluateNotEmpty(assertion: AssertionCandidate): AssertionOutcome | null {
    if (!hasAssertionCheck<EmptinessAssertionNode>(assertion, 'not-empty')) {
        return null;
    }

    const count = collectionCount(assertion.actual, 1);

    return assertionOutcome(
        count.supported ? count.count : assertion.actual,
        'more than 0',
        count.supported && count.count > 0
    );
}
