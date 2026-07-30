import { createBinaryDiff, shouldUseBinarySummary } from '../diff/binary-diff.ts';
import type {
    ArrayDiffOperation,
    MapDiffOperation,
    ObjectDiffOperation,
    SetDiffOperation
} from '../diff/diff-shape.ts';
import {
    comparisonResult,
    emptyPath,
    failedResult,
    firstDiffPath,
    valueMismatch,
    type ComparisonResult
} from './comparison-result.ts';
import {
    bytesFrom,
    compareExactly,
    comparePartially,
    mapEntries,
    rawProperty,
    setValues,
    sortedKeys,
    type RawMapEntry
} from './raw-comparison.ts';
import {
    byteSegment,
    indexSegment,
    mapKeySegment,
    mapValueSegment,
    propertySegment,
    setValueSegment
} from './diff-path.ts';
import { serializeValue } from './serialized-value.ts';
import {
    byteSourcePair,
    isByteSource,
    isDateValue,
    isErrorValue,
    isMapCandidate,
    isOpaqueIdentityValue,
    isRegExpValue,
    isSetCandidate,
    mapPair,
    prototypeOf,
    setPair,
    type ByteSource
} from './value-classification.ts';

type DiffMode = 'exact' | 'partial';

type BinaryReference = ArrayBuffer | ArrayBufferView;
type BuiltInReference = Date | Error | Promise<unknown> | RegExp;
type CollectionReference = ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>;
type WeakCollectionReference = WeakMap<Record<string, unknown>, unknown> | WeakSet<Record<string, unknown>>;
type StrongReference = BinaryReference | BuiltInReference | CollectionReference;
type ReferenceValue = Readonly<Record<string, unknown>> | StrongReference | WeakCollectionReference;

type ObjectOperationContext = {
    readonly actual: ReferenceValue;
    readonly actualKeys: readonly PropertyKey[];
    readonly expected: ReferenceValue;
    readonly mode: DiffMode;
};

type MatchedMapOperation = {
    readonly matchedIndex: number | null;
    readonly operation: MapDiffOperation | null;
};

function compareByMode(actual: unknown, expected: unknown, mode: DiffMode): boolean {
    return mode === 'partial' ? comparePartially(actual, expected) : compareExactly(actual, expected);
}

function objectMissingOperation(
    expectedKey: PropertyKey,
    expectedValue: unknown,
    mode: DiffMode
): ObjectDiffOperation {
    const path = [ propertySegment(expectedKey) ];

    return mode === 'partial'
        ? { operation: 'missing-property', path, value: serializeValue(expectedValue) }
        : { operation: 'remove', path, value: serializeValue(expectedValue) };
}

function objectReplacementOperation(
    actualValue: unknown,
    expectedValue: unknown,
    expectedKey: PropertyKey,
    mode: DiffMode
): ObjectDiffOperation | null {
    return compareByMode(actualValue, expectedValue, mode)
        ? null
        : {
            from: serializeValue(expectedValue),
            operation: 'replace',
            path: [ propertySegment(expectedKey) ],
            to: serializeValue(actualValue)
        };
}

function objectExpectedOperation(
    expectedKey: PropertyKey,
    context: ObjectOperationContext
): ObjectDiffOperation | null {
    const expectedValue = rawProperty(context.expected, expectedKey).value;

    if (!context.actualKeys.includes(expectedKey)) {
        return objectMissingOperation(expectedKey, expectedValue, context.mode);
    }

    const actualValue = rawProperty(context.actual, expectedKey).value;

    return objectReplacementOperation(actualValue, expectedValue, expectedKey, context.mode);
}

function objectAddedOperations(
    actual: ReferenceValue,
    actualKeys: readonly PropertyKey[],
    expectedKeys: readonly PropertyKey[],
    mode: DiffMode
): readonly ObjectDiffOperation[] {
    if (mode === 'partial') {
        return [];
    }

    return actualKeys
        .filter(function missingFromExpected(actualKey) {
            return !expectedKeys.includes(actualKey);
        })
        .map(function toAddOperation(actualKey) {
            return {
                operation: 'add',
                path: [ propertySegment(actualKey) ],
                value: serializeValue(rawProperty(actual, actualKey).value)
            };
        });
}

function objectKeyDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult {
    const actualKeys = sortedKeys(actual);
    const expectedKeys = sortedKeys(expected);

    if (actualKeys === null || expectedKeys === null) {
        return valueMismatch(actual, expected);
    }

    const context = { actual, actualKeys, expected, mode };
    const operations = [
        ...expectedKeys.flatMap(function operationForKey(expectedKey) {
            const operation = objectExpectedOperation(expectedKey, context);

            return operation === null ? [] : [ operation ];
        }),
        ...objectAddedOperations(actual, actualKeys, expectedKeys, mode)
    ];

    return comparisonResult({
        actual,
        diff: { kind: 'object', operations },
        expected,
        passed: operations.length === 0,
        path: operations[0]?.path ?? emptyPath
    });
}

function objectDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult {
    return mode === 'exact' && prototypeOf(actual) !== prototypeOf(expected)
        ? valueMismatch(actual, expected)
        : objectKeyDiff(actual, expected, mode);
}

function missingArrayIndexOperation(
    expected: readonly unknown[],
    index: number,
    mode: DiffMode
): ArrayDiffOperation {
    return mode === 'partial'
        ? { index, operation: 'missing-index', value: serializeValue(expected[index]) }
        : { operation: 'remove', path: [ indexSegment(index) ], value: serializeValue(expected[index]) };
}

function arrayReplacementOperation(
    actual: readonly unknown[],
    expected: readonly unknown[],
    index: number,
    mode: DiffMode
): ArrayDiffOperation | null {
    if (compareByMode(actual[index], expected[index], mode)) {
        return null;
    }

    return {
        from: serializeValue(expected[index]),
        operation: 'replace',
        path: [ indexSegment(index) ],
        to: serializeValue(actual[index])
    };
}

function arrayIndexOperation(
    actual: readonly unknown[],
    expected: readonly unknown[],
    index: number,
    mode: DiffMode
): ArrayDiffOperation | null {
    const actualHasIndex = Object.hasOwn(actual, index);
    const expectedHasIndex = Object.hasOwn(expected, index);

    if (!expectedHasIndex) {
        return actualHasIndex
            ? { operation: 'add', path: [ indexSegment(index) ], value: serializeValue(actual[index]) }
            : null;
    }

    if (!actualHasIndex) {
        return missingArrayIndexOperation(expected, index, mode);
    }

    return arrayReplacementOperation(actual, expected, index, mode);
}

function arrayDiff(actual: readonly unknown[], expected: readonly unknown[], mode: DiffMode): ComparisonResult {
    const length = mode === 'partial' ? expected.length : Math.max(actual.length, expected.length);
    const operations = Array
        .from({ length }, function operationAtIndex(_ignoredValue, index) {
            return arrayIndexOperation(actual, expected, index, mode);
        })
        .filter(function operationExists(operation): operation is ArrayDiffOperation {
            return operation !== null;
        });

    return comparisonResult({
        actual,
        diff: { kind: 'array', operations },
        expected,
        passed: operations.length === 0,
        path: firstDiffPath({ kind: 'array', operations })
    });
}

function missingMapEntryOperation(expectedEntry: RawMapEntry, mode: DiffMode): MapDiffOperation {
    return mode === 'partial'
        ? {
            key: serializeValue(expectedEntry.key),
            operation: 'missing-entry',
            value: serializeValue(expectedEntry.value)
        }
        : {
            operation: 'remove',
            path: [ mapKeySegment(expectedEntry.key) ],
            value: serializeValue(expectedEntry.value)
        };
}

function mapExpectedOperation(
    expectedEntry: RawMapEntry,
    actualEntries: readonly RawMapEntry[],
    matchedActualIndexes: ReadonlySet<number>,
    mode: DiffMode
): MatchedMapOperation {
    const matchIndex = actualEntries.findIndex(function matchingKey(actualEntry, index) {
        return !matchedActualIndexes.has(index) && compareExactly(actualEntry.key, expectedEntry.key);
    });

    if (matchIndex === -1) {
        return { matchedIndex: null, operation: missingMapEntryOperation(expectedEntry, mode) };
    }

    const actualEntry = actualEntries[matchIndex];

    if (actualEntry === undefined || compareByMode(actualEntry.value, expectedEntry.value, mode)) {
        return { matchedIndex: matchIndex, operation: null };
    }

    return {
        matchedIndex: matchIndex,
        operation: {
            from: serializeValue(expectedEntry.value),
            operation: 'replace',
            path: [ mapValueSegment(expectedEntry.key) ],
            to: serializeValue(actualEntry.value)
        }
    };
}

function mapAddedOperations(
    actualEntries: readonly RawMapEntry[],
    matchedActualIndexes: ReadonlySet<number>,
    mode: DiffMode
): readonly MapDiffOperation[] {
    if (mode === 'partial') {
        return [];
    }

    return actualEntries.flatMap(function extraEntry(actualEntry, index) {
        return matchedActualIndexes.has(index)
            ? []
            : [ {
                operation: 'add',
                path: [ mapKeySegment(actualEntry.key) ],
                value: serializeValue(actualEntry.value)
            } ];
    });
}

function mapDiff(
    actual: ReadonlyMap<unknown, unknown>,
    expected: ReadonlyMap<unknown, unknown>,
    mode: DiffMode
): ComparisonResult {
    const actualEntries = mapEntries(actual);
    const expectedEntries = mapEntries(expected);
    const matchedActualIndexes = new Set<number>();
    const expectedOperations = expectedEntries.flatMap(function operationForEntry(expectedEntry) {
        const result = mapExpectedOperation(expectedEntry, actualEntries, matchedActualIndexes, mode);

        if (result.matchedIndex !== null) {
            matchedActualIndexes.add(result.matchedIndex);
        }

        return result.operation === null ? [] : [ result.operation ];
    });
    const operations = [
        ...expectedOperations,
        ...mapAddedOperations(actualEntries, matchedActualIndexes, mode)
    ];

    return comparisonResult({
        actual,
        diff: { kind: 'map', operations },
        expected,
        passed: operations.length === 0,
        path: firstDiffPath({ kind: 'map', operations })
    });
}

function setMissingOperation(expectedValue: unknown, mode: DiffMode): SetDiffOperation {
    return mode === 'partial'
        ? { operation: 'missing-member', value: serializeValue(expectedValue) }
        : {
            operation: 'remove',
            path: [ setValueSegment(expectedValue) ],
            value: serializeValue(expectedValue)
        };
}

function setAddedOperations(
    actualValues: readonly unknown[],
    matchedActualIndexes: ReadonlySet<number>,
    mode: DiffMode
): readonly SetDiffOperation[] {
    if (mode === 'partial') {
        return [];
    }

    return actualValues.flatMap(function extraValue(actualValue, index) {
        return matchedActualIndexes.has(index)
            ? []
            : [ {
                operation: 'add',
                path: [ setValueSegment(actualValue) ],
                value: serializeValue(actualValue)
            } ];
    });
}

function setDiff(actual: ReadonlySet<unknown>, expected: ReadonlySet<unknown>, mode: DiffMode): ComparisonResult {
    const actualValues = setValues(actual);
    const expectedValues = setValues(expected);
    const matchedActualIndexes = new Set<number>();
    const missingOperations = expectedValues.flatMap(function operationForValue(expectedValue) {
        const matchIndex = actualValues.findIndex(function matchingValue(actualValue, index) {
            return !matchedActualIndexes.has(index) && compareByMode(actualValue, expectedValue, mode);
        });

        if (matchIndex === -1) {
            return [ setMissingOperation(expectedValue, mode) ];
        }

        matchedActualIndexes.add(matchIndex);

        return [];
    });
    const operations = [
        ...missingOperations,
        ...setAddedOperations(actualValues, matchedActualIndexes, mode)
    ];

    return comparisonResult({
        actual,
        diff: { kind: 'set', operations },
        expected,
        passed: operations.length === 0,
        path: firstDiffPath({ kind: 'set', operations })
    });
}

function byteOperation(
    actualBytes: readonly number[],
    expectedBytes: readonly number[],
    offset: number
): ArrayDiffOperation | null {
    return actualBytes[offset] === expectedBytes[offset]
        ? null
        : {
            from: serializeValue(expectedBytes[offset]),
            operation: 'replace',
            path: [ byteSegment(offset) ],
            to: serializeValue(actualBytes[offset])
        };
}

function byteDiff(actual: ByteSource, expected: ByteSource): ComparisonResult {
    const actualBytes = bytesFrom(actual);
    const expectedBytes = bytesFrom(expected);

    if (shouldUseBinarySummary(expectedBytes, actualBytes)) {
        return failedResult(actual, expected, createBinaryDiff(expectedBytes, actualBytes));
    }

    const length = Math.max(actualBytes.length, expectedBytes.length);
    const operations = Array
        .from({ length }, function operationForOffset(_ignoredValue, offset) {
            return byteOperation(actualBytes, expectedBytes, offset);
        })
        .filter(function operationExists(operation): operation is ArrayDiffOperation {
            return operation !== null;
        });

    return comparisonResult({
        actual,
        diff: { kind: 'array', operations },
        expected,
        passed: operations.length === 0,
        path: firstDiffPath({ kind: 'array', operations })
    });
}

function errorHeaderOperations(actual: Error, expected: Error): readonly ObjectDiffOperation[] {
    const operations: ObjectDiffOperation[] = [];

    if (actual.name !== expected.name) {
        operations.push({
            from: serializeValue(expected.name),
            operation: 'replace',
            path: [ propertySegment('name') ],
            to: serializeValue(actual.name)
        });
    }

    if (actual.message !== expected.message) {
        operations.push({
            from: serializeValue(expected.message),
            operation: 'replace',
            path: [ propertySegment('message') ],
            to: serializeValue(actual.message)
        });
    }

    return operations;
}

function errorDiff(actual: Error, expected: Error, mode: DiffMode): ComparisonResult {
    const enumerableDiff = objectDiff(actual, expected, mode);
    const enumerableOperations = enumerableDiff.diff?.kind === 'object' ? enumerableDiff.diff.operations : [];
    const operations = [
        ...errorHeaderOperations(actual, expected),
        ...enumerableOperations
    ];

    return comparisonResult({
        actual,
        diff: { kind: 'object', operations },
        expected,
        passed: operations.length === 0,
        path: operations[0]?.path ?? emptyPath
    });
}

function unsupportedSpecialObjectDiff(actual: ReferenceValue, expected: ReferenceValue): ComparisonResult | null {
    const unsupported = [
        isDateValue(actual),
        isDateValue(expected),
        isRegExpValue(actual),
        isRegExpValue(expected),
        isOpaqueIdentityValue(actual),
        isOpaqueIdentityValue(expected)
    ]
        .some(Boolean);

    return unsupported
        ? valueMismatch(actual, expected)
        : null;
}

function errorObjectDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult | null {
    if (!isErrorValue(actual) && !isErrorValue(expected)) {
        return null;
    }

    return isErrorValue(actual) && isErrorValue(expected) && prototypeOf(actual) === prototypeOf(expected)
        ? errorDiff(actual, expected, mode)
        : valueMismatch(actual, expected);
}

function mapObjectDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult | null {
    const matchedMapPair = mapPair(actual, expected);

    if (matchedMapPair !== null) {
        return mapDiff(matchedMapPair.actual, matchedMapPair.expected, mode);
    }

    return isMapCandidate(actual) || isMapCandidate(expected) ? valueMismatch(actual, expected) : null;
}

function setObjectDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult | null {
    const matchedSetPair = setPair(actual, expected);

    if (matchedSetPair !== null) {
        return setDiff(matchedSetPair.actual, matchedSetPair.expected, mode);
    }

    return isSetCandidate(actual) || isSetCandidate(expected) ? valueMismatch(actual, expected) : null;
}

function objectPairDiff(actual: ReferenceValue, expected: ReferenceValue, mode: DiffMode): ComparisonResult {
    return unsupportedSpecialObjectDiff(actual, expected) ??
        errorObjectDiff(actual, expected, mode) ??
        mapObjectDiff(actual, expected, mode) ??
        setObjectDiff(actual, expected, mode) ??
        objectDiff(actual, expected, mode);
}

function arrayDiffRule(actual: unknown, expected: unknown, mode: DiffMode): ComparisonResult | null {
    return Array.isArray(actual) && Array.isArray(expected) ? arrayDiff(actual, expected, mode) : null;
}

function byteDiffRule(actual: unknown, expected: unknown, mode: DiffMode): ComparisonResult | null {
    const matchedBytes = byteSourcePair(actual, expected);

    return mode === 'exact' && matchedBytes !== null ? byteDiff(matchedBytes.actual, matchedBytes.expected) : null;
}

function byteMismatchRule(actual: unknown, expected: unknown): ComparisonResult | null {
    return isByteSource(actual) || isByteSource(expected) ? valueMismatch(actual, expected) : null;
}

function isReferenceValue(value: unknown): value is ReferenceValue {
    return value !== null && typeof value === 'object';
}

function referenceDiffRule(actual: unknown, expected: unknown, mode: DiffMode): ComparisonResult | null {
    return isReferenceValue(actual) && isReferenceValue(expected) ? objectPairDiff(actual, expected, mode) : null;
}

function diffFor(actual: unknown, expected: unknown, mode: DiffMode): ComparisonResult {
    return arrayDiffRule(actual, expected, mode) ??
        byteDiffRule(actual, expected, mode) ??
        byteMismatchRule(actual, expected) ??
        referenceDiffRule(actual, expected, mode) ??
        valueMismatch(actual, expected);
}

export function exactStructuredDiff(actual: unknown, expected: unknown): ComparisonResult {
    return diffFor(actual, expected, 'exact');
}

export function partialStructuredDiff(actual: unknown, expected: unknown): ComparisonResult {
    return diffFor(actual, expected, 'partial');
}
