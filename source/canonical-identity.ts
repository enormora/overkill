type CanonicalJsonValue = boolean | number | string | readonly CanonicalJsonValue[] | {
    readonly [key: string]: CanonicalJsonValue;
} | null;

function sortedObjectKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
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

function canonicalScalar(value: unknown): boolean | number | string | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return canonicalNumber(value);
    }

    if (typeof value === 'string') {
        return value.normalize('NFC');
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
    canonicalize: (item: unknown) => CanonicalJsonValue
): CanonicalJsonValue {
    return Object.fromEntries(
        sortedObjectKeys(value).map(function toCanonicalEntry(key) {
            return [ key.normalize('NFC'), canonicalize(value[key]) ];
        })
    );
}

function canonicalJsonValue(value: unknown): CanonicalJsonValue {
    const scalar = canonicalScalar(value);

    if (scalar !== undefined) {
        return scalar;
    }

    if (value === null) {
        return null;
    }

    if (Array.isArray(value)) {
        return canonicalArray(value, canonicalJsonValue);
    }

    if (isRecord(value)) {
        return canonicalRecord(value, canonicalJsonValue);
    }

    throw new TypeError(`Cannot serialize ${typeof value} value for shard partitioning.`);
}

export function canonicalIdentityJson(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value));
}
