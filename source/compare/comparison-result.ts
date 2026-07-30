import type {
    ArrayDiffOperation,
    Diff,
    DiffPathSegment,
    MapDiffOperation,
    ObjectDiffOperation,
    SetDiffOperation
} from '../diff/diff-shape.ts';
import { type SerializedValue, serializeValue } from './serialized-value.ts';

export type ComparisonResult = {
    readonly actual: SerializedValue;
    readonly diff: Diff | null;
    readonly expected: SerializedValue;
    readonly passed: boolean;
    readonly path: readonly DiffPathSegment[];
};

type ComparisonResultInput = {
    readonly actual: unknown;
    readonly diff: Diff | null;
    readonly expected: unknown;
    readonly passed: boolean;
    readonly path: readonly DiffPathSegment[];
};

export const emptyPath: readonly DiffPathSegment[] = [];

function indexSegment(index: number): DiffPathSegment {
    return { index, kind: 'index' };
}

function operationPath(
    operation: ArrayDiffOperation | MapDiffOperation | ObjectDiffOperation | SetDiffOperation
): readonly DiffPathSegment[] {
    if (operation.operation === 'missing-index') {
        return [ indexSegment(operation.index) ];
    }

    if (operation.operation === 'missing-entry' || operation.operation === 'missing-member') {
        return emptyPath;
    }

    return operation.path;
}

export function firstDiffPath(diff: Diff | null): readonly DiffPathSegment[] {
    if (diff === null || diff.kind === 'value' || diff.kind === 'string' || diff.kind === 'binary') {
        return emptyPath;
    }

    const operation = diff.operations[0];

    return operation === undefined ? emptyPath : operationPath(operation);
}

export function comparisonResult(input: ComparisonResultInput): ComparisonResult {
    return {
        actual: serializeValue(input.actual),
        diff: input.diff,
        expected: serializeValue(input.expected),
        passed: input.passed,
        path: input.path
    };
}

export function passedResult(actual: unknown, expected: unknown): ComparisonResult {
    return comparisonResult({ actual, diff: null, expected, passed: true, path: emptyPath });
}

export function failedResult(actual: unknown, expected: unknown, diff: Diff | null): ComparisonResult {
    return comparisonResult({ actual, diff, expected, passed: false, path: firstDiffPath(diff) });
}

export function serializedValueDiff(actual: unknown, expected: unknown): Diff {
    return {
        actual: serializeValue(actual),
        expected: serializeValue(expected),
        kind: 'value'
    };
}

export function valueMismatch(actual: unknown, expected: unknown): ComparisonResult {
    return failedResult(actual, expected, serializedValueDiff(actual, expected));
}
