export type ByteSource = ArrayBuffer | ArrayBufferView;

type ByteSourcePair = {
    readonly actual: ByteSource;
    readonly expected: ByteSource;
};

type MapPair = {
    readonly actual: ReadonlyMap<unknown, unknown>;
    readonly expected: ReadonlyMap<unknown, unknown>;
};

type SetPair = {
    readonly actual: ReadonlySet<unknown>;
    readonly expected: ReadonlySet<unknown>;
};

function isArrayBufferValue(value: unknown): value is ArrayBuffer {
    try {
        return value instanceof ArrayBuffer;
    } catch {
        return false;
    }
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
    try {
        return ArrayBuffer.isView(value);
    } catch {
        return false;
    }
}

export function isByteSource(value: unknown): value is ByteSource {
    return isArrayBufferValue(value) || isArrayBufferView(value);
}

export function byteSourcePair(actual: unknown, expected: unknown): ByteSourcePair | null {
    if (isArrayBufferValue(actual) && isArrayBufferValue(expected)) {
        return { actual, expected };
    }

    return isArrayBufferView(actual) && isArrayBufferView(expected) && actual.constructor === expected.constructor
        ? { actual, expected }
        : null;
}

export function isDateValue(value: unknown): value is Date {
    try {
        return value instanceof Date;
    } catch {
        return false;
    }
}

export function isRegExpValue(value: unknown): value is RegExp {
    try {
        return value instanceof RegExp;
    } catch {
        return false;
    }
}

export function isErrorValue(value: unknown): value is Error {
    try {
        return value instanceof Error;
    } catch {
        return false;
    }
}

function isMapValue(value: unknown): value is ReadonlyMap<unknown, unknown> {
    try {
        return Object.getPrototypeOf(value) === Map.prototype;
    } catch {
        return false;
    }
}

function isSetValue(value: unknown): value is ReadonlySet<unknown> {
    try {
        return Object.getPrototypeOf(value) === Set.prototype;
    } catch {
        return false;
    }
}

export function mapPair(actual: unknown, expected: unknown): MapPair | null {
    return isMapValue(actual) && isMapValue(expected) ? { actual, expected } : null;
}

export function setPair(actual: unknown, expected: unknown): SetPair | null {
    return isSetValue(actual) && isSetValue(expected) ? { actual, expected } : null;
}

export const isMapCandidate: (value: unknown) => boolean = isMapValue;

export const isSetCandidate: (value: unknown) => boolean = isSetValue;

function isPromiseValue(value: unknown): boolean {
    try {
        return value instanceof Promise;
    } catch {
        return false;
    }
}

function isWeakMapValue(value: unknown): boolean {
    try {
        return value instanceof WeakMap;
    } catch {
        return false;
    }
}

function isWeakSetValue(value: unknown): boolean {
    try {
        return value instanceof WeakSet;
    } catch {
        return false;
    }
}

export function isOpaqueIdentityValue(value: unknown): boolean {
    return isPromiseValue(value) || isWeakMapValue(value) || isWeakSetValue(value);
}

export function prototypeOf(value: unknown): unknown {
    try {
        const prototype: unknown = Object.getPrototypeOf(value);

        return prototype;
    } catch {
        return null;
    }
}
