import { deepEqual } from 'fast-equals';

export function isPlainObject(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

export function ownKeys(value: Readonly<Record<PropertyKey, unknown>>): readonly PropertyKey[] {
    return Reflect.ownKeys(value);
}

function propertyValue(value: Readonly<Record<PropertyKey, unknown>>, key: PropertyKey): unknown {
    return value[key];
}

type PartialMatcher = (actual: unknown, expected: unknown) => boolean;

function arrayPartiallyMatches(actual: unknown, expected: readonly unknown[], match: PartialMatcher): boolean {
    return Array.isArray(actual) &&
        expected.every(function itemMatches(expectedItem, index) {
            return match(actual[index], expectedItem);
        });
}

function mapPartiallyMatches(actual: unknown, expected: ReadonlyMap<unknown, unknown>, match: PartialMatcher): boolean {
    if (!(actual instanceof Map)) {
        return false;
    }

    return Array.from(expected).every(function entryMatches([ expectedKey, expectedValue ]) {
        return Array.from(actual).some(function actualEntryMatches([ actualKey, actualValue ]) {
            return deepEqual(actualKey, expectedKey) && match(actualValue, expectedValue);
        });
    });
}

function setPartiallyMatches(actual: unknown, expected: ReadonlySet<unknown>, match: PartialMatcher): boolean {
    if (!(actual instanceof Set)) {
        return false;
    }

    return Array.from(expected).every(function itemMatches(expectedItem) {
        return Array.from(actual).some(function actualItemMatches(actualItem) {
            return match(actualItem, expectedItem);
        });
    });
}

function objectPartiallyMatches(
    actual: unknown,
    expected: Readonly<Record<PropertyKey, unknown>>,
    match: PartialMatcher
): boolean {
    if (!isPlainObject(actual)) {
        return false;
    }

    return ownKeys(expected).every(function propertyMatches(key) {
        return Object.hasOwn(actual, key) && match(propertyValue(actual, key), propertyValue(expected, key));
    });
}

export function partialDeepEqual(actual: unknown, expected: unknown): boolean {
    if (Array.isArray(expected)) {
        return arrayPartiallyMatches(actual, expected, partialDeepEqual);
    }

    if (expected instanceof Map) {
        return mapPartiallyMatches(actual, expected, partialDeepEqual);
    }

    if (expected instanceof Set) {
        return setPartiallyMatches(actual, expected, partialDeepEqual);
    }

    return isPlainObject(expected)
        ? objectPartiallyMatches(actual, expected, partialDeepEqual)
        : deepEqual(actual, expected);
}
