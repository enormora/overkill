import { snapshotValidatedJsonValue } from './attachments/json-snapshot.ts';

export type PortableValue = boolean | number | string | readonly PortableValue[] | {
    readonly [key: string]: PortableValue;
} | null;

function validateDataProperty(value: unknown, key: PropertyKey): void {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Portable inputs require enumerable string data properties.');
    }
}

function validateArrayProperty(value: readonly unknown[], key: PropertyKey): void {
    if (key === 'length') {
        return;
    }
    validateDataProperty(value, key);
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/v.test(key) || Number(key) >= value.length) {
        throw new TypeError('Portable arrays cannot contain additional properties.');
    }
}

function validatePortableValue(value: unknown): void {
    if (Object.is(value, -0)) {
        throw new TypeError('Portable inputs require lossless JSON numbers.');
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
            throw new TypeError('Portable inputs require ordinary JSON arrays.');
        }
        Reflect.ownKeys(value).forEach(function validateKey(key) {
            validateArrayProperty(value, key);
        });
        return;
    }
    Reflect.ownKeys(value).forEach(function validateKey(key) {
        validateDataProperty(value, key);
    });
}

export function snapshotPortableValue<Value extends PortableValue>(value: Value): Value;
export function snapshotPortableValue(value: unknown): PortableValue;
export function snapshotPortableValue(value: unknown): PortableValue {
    try {
        return snapshotValidatedJsonValue(value, validatePortableValue);
    } catch (error: unknown) {
        throw new TypeError('Portable inputs require lossless, acyclic JSON.', { cause: error });
    }
}
