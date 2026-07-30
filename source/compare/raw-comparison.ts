import { createComparisonState, objectPairStatus, type ComparisonState } from './comparison-state.ts';
import {
    byteSourcePair,
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

type BinaryReference = ArrayBuffer | ArrayBufferView;
type BuiltInReference = Date | Error | Promise<unknown> | RegExp;
type CollectionReference = ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>;
type WeakCollectionReference = WeakMap<Record<string, unknown>, unknown> | WeakSet<Record<string, unknown>>;
type StrongReference = BinaryReference | BuiltInReference | CollectionReference;
type ReferenceValue = Readonly<Record<string, unknown>> | StrongReference | WeakCollectionReference;

export type RawProperty = {
    readonly key: PropertyKey;
    readonly value: unknown;
};

export type RawMapEntry = {
    readonly key: unknown;
    readonly value: unknown;
};

type ComparisonMode = 'exact' | 'partial';

type RawComparator = (
    actual: unknown,
    expected: unknown,
    state: ComparisonState,
    mode: ComparisonMode
) => boolean;

type ComparisonContext = {
    readonly compare: RawComparator;
    readonly mode: ComparisonMode;
    readonly state: ComparisonState;
};

type ReferenceComparison = (
    actual: ReferenceValue,
    expected: ReferenceValue,
    context: ComparisonContext
) => boolean | null;

function keyText(key: PropertyKey): string {
    return typeof key === 'symbol' ? key.toString() : String(key);
}

function safePropertyDescriptor(value: ReferenceValue, key: PropertyKey): PropertyDescriptor | undefined {
    try {
        return Object.getOwnPropertyDescriptor(value, key);
    } catch {
        return undefined;
    }
}

export function sortedKeys(value: ReferenceValue): readonly PropertyKey[] | null {
    try {
        const descriptors = Object.getOwnPropertyDescriptors(value);

        return Reflect
            .ownKeys(descriptors)
            .filter(function enumerableDataKey(key) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);

                return descriptor?.enumerable === true;
            })
            .toSorted(function compareKeys(first, second) {
                return keyText(first).localeCompare(keyText(second));
            });
    } catch {
        return null;
    }
}

export function rawProperty(value: ReferenceValue, key: PropertyKey): RawProperty {
    const descriptor = safePropertyDescriptor(value, key);

    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return {
            key,
            value: { accessor: true }
        };
    }

    return { key, value: descriptor.value };
}

export function bytesFrom(value: ByteSource): readonly number[] {
    if (value instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(value));
    }

    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}

function compareBytes(actual: ByteSource, expected: ByteSource): boolean {
    const actualBytes = bytesFrom(actual);
    const expectedBytes = bytesFrom(expected);

    return actualBytes.length === expectedBytes.length &&
        actualBytes.every(function sameByte(actualByte, index) {
            return actualByte === expectedBytes[index];
        });
}

export function mapEntries(value: ReadonlyMap<unknown, unknown>): readonly RawMapEntry[] {
    return Array.from(value, function toEntry([ key, entryValue ]) {
        return { key, value: entryValue };
    });
}

export function setValues(value: ReadonlySet<unknown>): readonly unknown[] {
    return Array.from(value);
}

function primitiveOrFunction(value: unknown): boolean {
    return value === null || typeof value !== 'object';
}

function compareSeenObjects(actual: ReferenceValue, expected: ReferenceValue, state: ComparisonState): boolean | null {
    const pairStatus = objectPairStatus(actual, expected, state);

    if (pairStatus === 'seen') {
        return true;
    }

    return pairStatus === 'topology-mismatch' ? false : null;
}

function objectKeyCountMatches(
    actualKeys: readonly PropertyKey[],
    expectedKeys: readonly PropertyKey[],
    mode: ComparisonMode
): boolean {
    return mode === 'partial' || actualKeys.length === expectedKeys.length;
}

function compareArrays(actual: readonly unknown[], expected: readonly unknown[], context: ComparisonContext): boolean {
    const exactLengthMismatch = context.mode === 'exact' && actual.length !== expected.length;
    const partialLengthMismatch = context.mode === 'partial' && actual.length < expected.length;

    if (exactLengthMismatch || partialLengthMismatch) {
        return false;
    }

    return Array.from({ length: expected.length }).every(function itemMatches(_unusedValue, index) {
        const expectedValue = expected[index];

        return Object.hasOwn(actual, index) === Object.hasOwn(expected, index) &&
            (!Object.hasOwn(expected, index) ||
                context.compare(actual[index], expectedValue, context.state, context.mode));
    });
}

function compareObjects(actual: ReferenceValue, expected: ReferenceValue, context: ComparisonContext): boolean {
    const actualKeys = sortedKeys(actual);
    const expectedKeys = sortedKeys(expected);

    if (actualKeys === null || expectedKeys === null) {
        return false;
    }

    return objectKeyCountMatches(actualKeys, expectedKeys, context.mode) &&
        expectedKeys.every(function propertyMatches(expectedKey) {
            return actualKeys.includes(expectedKey) &&
                context.compare(
                    rawProperty(actual, expectedKey).value,
                    rawProperty(expected, expectedKey).value,
                    context.state,
                    context.mode
                );
        });
}

function matchedMapIndex(
    actualEntries: readonly RawMapEntry[],
    expectedEntry: RawMapEntry,
    matchedActualIndexes: ReadonlySet<number>,
    context: ComparisonContext
): number {
    return actualEntries.findIndex(function matchesEntry(actualEntry, index) {
        return !matchedActualIndexes.has(index) &&
            context.compare(actualEntry.key, expectedEntry.key, createComparisonState(), 'exact') &&
            context.compare(actualEntry.value, expectedEntry.value, createComparisonState(), context.mode);
    });
}

function mapSizeMatches(
    actualEntries: readonly RawMapEntry[],
    expectedEntries: readonly RawMapEntry[],
    mode: ComparisonMode
): boolean {
    return mode === 'partial' || actualEntries.length === expectedEntries.length;
}

function compareMaps(
    actual: ReadonlyMap<unknown, unknown>,
    expected: ReadonlyMap<unknown, unknown>,
    context: ComparisonContext
): boolean {
    const actualEntries = mapEntries(actual);
    const expectedEntries = mapEntries(expected);
    const matchedActualIndexes = new Set<number>();

    return mapSizeMatches(actualEntries, expectedEntries, context.mode) &&
        expectedEntries.every(function entryMatches(expectedEntry) {
            const matchIndex = matchedMapIndex(actualEntries, expectedEntry, matchedActualIndexes, context);
            const actualEntry = actualEntries[matchIndex];
            const matched = actualEntry !== undefined &&
                context.compare(actualEntry.key, expectedEntry.key, context.state, 'exact') &&
                context.compare(actualEntry.value, expectedEntry.value, context.state, context.mode);

            if (matched) {
                matchedActualIndexes.add(matchIndex);
            }

            return matched;
        });
}

function matchedSetIndex(
    actualValues: readonly unknown[],
    expectedValue: unknown,
    matchedActualIndexes: ReadonlySet<number>,
    context: ComparisonContext
): number {
    return actualValues.findIndex(function matchesValue(actualValue, index) {
        return !matchedActualIndexes.has(index) &&
            context.compare(actualValue, expectedValue, createComparisonState(), context.mode);
    });
}

function setSizeMatches(
    actualValues: readonly unknown[],
    expectedValues: readonly unknown[],
    mode: ComparisonMode
): boolean {
    return mode === 'partial' || actualValues.length === expectedValues.length;
}

function compareSets(
    actual: ReadonlySet<unknown>,
    expected: ReadonlySet<unknown>,
    context: ComparisonContext
): boolean {
    const actualValues = setValues(actual);
    const expectedValues = setValues(expected);
    const matchedActualIndexes = new Set<number>();

    return setSizeMatches(actualValues, expectedValues, context.mode) &&
        expectedValues.every(function valueMatches(expectedValue) {
            const matchIndex = matchedSetIndex(actualValues, expectedValue, matchedActualIndexes, context);
            const actualValue = actualValues[matchIndex];
            const matched = context.compare(actualValue, expectedValue, context.state, context.mode);

            if (matched) {
                matchedActualIndexes.add(matchIndex);
            }

            return matched;
        });
}

function compareErrors(
    actual: Error,
    expected: Error,
    context: ComparisonContext
): boolean {
    return actual.name === expected.name &&
        actual.message === expected.message &&
        compareObjects(actual, expected, context);
}

function firstReferenceResult(
    comparisons: readonly ReferenceComparison[],
    actual: ReferenceValue,
    expected: ReferenceValue,
    context: ComparisonContext
): boolean {
    for (const comparison of comparisons) {
        const comparisonResult = comparison(actual, expected, context);

        if (comparisonResult !== null) {
            return comparisonResult;
        }
    }

    return false;
}

const exactReferenceComparisons: readonly ReferenceComparison[] = [
    function compareArrayValues(actual, expected, context) {
        if (!Array.isArray(actual) && !Array.isArray(expected)) {
            return null;
        }

        return Array.isArray(actual) && Array.isArray(expected) && compareArrays(actual, expected, context);
    },
    function compareByteValues(actual, expected) {
        const pair = byteSourcePair(actual, expected);

        return pair === null ? null : compareBytes(pair.actual, pair.expected);
    },
    function compareDateValues(actual, expected) {
        return isDateValue(actual) || isDateValue(expected)
            ? isDateValue(actual) && isDateValue(expected) && Object.is(actual.getTime(), expected.getTime())
            : null;
    },
    function compareRegExpValues(actual, expected) {
        if (!isRegExpValue(actual) && !isRegExpValue(expected)) {
            return null;
        }

        return isRegExpValue(actual) && isRegExpValue(expected) &&
            actual.source === expected.source &&
            actual.flags === expected.flags;
    },
    function compareErrorValues(actual, expected, context) {
        return isErrorValue(actual) || isErrorValue(expected)
            ? isErrorValue(actual) && isErrorValue(expected) && compareErrors(actual, expected, context)
            : null;
    },
    function compareOpaqueValues(actual, expected) {
        return isOpaqueIdentityValue(actual) || isOpaqueIdentityValue(expected) ? false : null;
    },
    function compareMapValues(actual, expected, context) {
        const pair = mapPair(actual, expected);

        return isMapCandidate(actual) || isMapCandidate(expected)
            ? pair !== null && compareMaps(pair.actual, pair.expected, context)
            : null;
    },
    function compareSetValues(actual, expected, context) {
        const pair = setPair(actual, expected);

        return isSetCandidate(actual) || isSetCandidate(expected)
            ? pair !== null && compareSets(pair.actual, pair.expected, context)
            : null;
    },
    function compareObjectValues(actual, expected, context) {
        return prototypeOf(actual) === prototypeOf(expected) &&
            compareObjects(actual, expected, context);
    }
];

const partialReferenceComparisons: readonly ReferenceComparison[] = [
    function compareArrayValues(actual, expected, context) {
        return Array.isArray(expected)
            ? Array.isArray(actual) && compareArrays(actual, expected, context)
            : null;
    },
    function compareByteValues(actual, expected) {
        const pair = byteSourcePair(actual, expected);

        return pair === null ? null : compareBytes(pair.actual, pair.expected);
    },
    function compareDateValues(actual, expected) {
        return isDateValue(expected)
            ? isDateValue(actual) && Object.is(actual.getTime(), expected.getTime())
            : null;
    },
    function compareRegExpValues(actual, expected) {
        return isRegExpValue(expected)
            ? isRegExpValue(actual) && actual.source === expected.source && actual.flags === expected.flags
            : null;
    },
    function compareErrorValues(actual, expected, context) {
        return isErrorValue(expected)
            ? isErrorValue(actual) && compareErrors(actual, expected, context)
            : null;
    },
    function compareOpaqueValues(actual, expected) {
        return isOpaqueIdentityValue(actual) || isOpaqueIdentityValue(expected) ? false : null;
    },
    function compareMapValues(actual, expected, context) {
        const pair = mapPair(actual, expected);

        return isMapCandidate(expected)
            ? pair !== null && compareMaps(pair.actual, pair.expected, context)
            : null;
    },
    function compareSetValues(actual, expected, context) {
        const pair = setPair(actual, expected);

        return isSetCandidate(expected)
            ? pair !== null && compareSets(pair.actual, pair.expected, context)
            : null;
    },
    compareObjects
];

function isReferenceValue(value: unknown): value is ReferenceValue {
    return value !== null && typeof value === 'object';
}

function compareReferences(actual: ReferenceValue, expected: ReferenceValue, context: ComparisonContext): boolean {
    const seen = compareSeenObjects(actual, expected, context.state);

    if (seen !== null) {
        return seen;
    }

    const comparisons = context.mode === 'exact' ? exactReferenceComparisons : partialReferenceComparisons;

    return firstReferenceResult(comparisons, actual, expected, context);
}

function compareRaw(actual: unknown, expected: unknown, state: ComparisonState, mode: ComparisonMode): boolean {
    if (Object.is(actual, expected)) {
        return true;
    }

    if (primitiveOrFunction(actual) || primitiveOrFunction(expected)) {
        return false;
    }

    return isReferenceValue(actual) && isReferenceValue(expected)
        ? compareReferences(actual, expected, { compare: compareRaw, mode, state })
        : false;
}

export function compareExactly(actual: unknown, expected: unknown): boolean {
    return compareRaw(actual, expected, createComparisonState(), 'exact');
}

export function comparePartially(actual: unknown, expected: unknown): boolean {
    return compareRaw(actual, expected, createComparisonState(), 'partial');
}
