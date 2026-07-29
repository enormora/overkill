import { type ComparisonResult, serializedOutcome } from '../compare/comparison.ts';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type { Diff, DiffPathSegment } from '../diff/diff-shape.ts';

export type AssertionOutcome = {
    readonly actual: SerializedValue;
    readonly diff: Diff | null;
    readonly expected: SerializedValue;
    readonly passed: boolean;
    readonly path: readonly DiffPathSegment[];
};

export const assertionOutcome: (actual: unknown, expected: unknown, passed: boolean) => AssertionOutcome =
    serializedOutcome;

export function comparisonOutcome(comparison: ComparisonResult): AssertionOutcome {
    return comparison;
}
