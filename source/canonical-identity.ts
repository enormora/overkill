type StringIdentity = 'exact' | 'unicode';
type CanonicalJsonValue = boolean | number | string | readonly CanonicalJsonValue[] | {
    readonly [key: string]: CanonicalJsonValue;
} | null;

function sortedObjectKeys(value: Readonly<Record<string, unknown>>, strings: StringIdentity): readonly string[] {
    if (strings === 'exact') {
        return Object.keys(value).toSorted(function compareExact(left, right) {
            const ordering = left.localeCompare(right, 'en');
            if (ordering !== 0 || left === right) {
                return ordering;
            }
            return left < right ? -1 : 1;
        });
    }
    return Object.keys(value).toSorted(function compareKeys(left, right) {
        return left.localeCompare(right);
    });
}

function canonicalNumber(value: number): number {
    if (Number.isFinite(value)) {
        return value;
    }

    throw new TypeError('Cannot serialize number value for shard partitioning.');
}

function canonicalScalar(value: unknown, strings: StringIdentity): boolean | number | string | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return canonicalNumber(value);
    }

    if (typeof value === 'string') {
        return strings === 'unicode' ? value.normalize('NFC') : value;
    }

    return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalArray(
    value: readonly unknown[],
    canonicalize: (item: unknown) => CanonicalJsonValue
): readonly CanonicalJsonValue[] {
    return value.map(canonicalize);
}

function canonicalRecord(
    value: Readonly<Record<string, unknown>>,
    canonicalize: (item: unknown) => CanonicalJsonValue,
    strings: StringIdentity
): CanonicalJsonValue {
    return Object.fromEntries(
        sortedObjectKeys(value, strings).map(function toCanonicalEntry(key) {
            return [ strings === 'unicode' ? key.normalize('NFC') : key, canonicalize(value[key]) ];
        })
    );
}

function canonicalJsonValue(value: unknown, strings: StringIdentity): CanonicalJsonValue {
    const scalar = canonicalScalar(value, strings);

    if (scalar !== undefined) {
        return scalar;
    }

    if (value === null) {
        return null;
    }

    if (Array.isArray(value)) {
        return canonicalArray(value, function canonicalize(item) {
            return canonicalJsonValue(item, strings);
        });
    }

    if (isRecord(value)) {
        return canonicalRecord(value, function canonicalize(item) {
            return canonicalJsonValue(item, strings);
        }, strings);
    }

    throw new TypeError(`Cannot serialize ${typeof value} value for shard partitioning.`);
}

export function canonicalIdentityJson(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value, 'unicode'));
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value, 'exact'));
}
