function constructorNameFromPrototype(prototype: unknown): string {
    if (prototype === null || typeof prototype !== 'object') {
        return 'Object';
    }

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const constructorValue: unknown = descriptor?.value;
    const name = typeof constructorValue === 'function' ? constructorValue.name : 'Object';

    return name.length === 0 ? '(anonymous)' : name;
}

export function constructorName(value: unknown): string {
    try {
        const prototype: unknown = Object.getPrototypeOf(value);

        return constructorNameFromPrototype(prototype);
    } catch {
        return 'Unavailable';
    }
}

export function prototypeIs(value: unknown, prototype: unknown): boolean {
    try {
        return Object.getPrototypeOf(value) === prototype;
    } catch {
        return false;
    }
}

export function isBufferValue(value: unknown): value is Buffer {
    try {
        return Buffer.isBuffer(value);
    } catch {
        return false;
    }
}

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
    try {
        return ArrayBuffer.isView(value);
    } catch {
        return false;
    }
}

export function isArrayBufferValue(value: unknown): value is ArrayBuffer {
    try {
        return value instanceof ArrayBuffer;
    } catch {
        return false;
    }
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

export function isPromiseValue(value: unknown): value is Promise<unknown> {
    try {
        return value instanceof Promise;
    } catch {
        return false;
    }
}

export function isWeakMapValue(
    value: unknown
): value is WeakMap<Record<string, unknown>, unknown> {
    try {
        return value instanceof WeakMap;
    } catch {
        return false;
    }
}

export function isWeakSetValue(value: unknown): value is WeakSet<Record<string, unknown>> {
    try {
        return value instanceof WeakSet;
    } catch {
        return false;
    }
}
