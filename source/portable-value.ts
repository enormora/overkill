import { snapshotPortableJsonValue } from './attachments/json-snapshot.ts';

export type PortableValue = boolean | number | string | readonly PortableValue[] | {
    readonly [key: string]: PortableValue;
} | null;

function validatePortableValue(value: unknown): void {
    if (Object.is(value, -0)) {
        throw new TypeError('Portable inputs require lossless JSON numbers.');
    }
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('Portable inputs require ordinary JSON arrays.');
    }
}

export function snapshotPortableValue<Value extends PortableValue>(value: Value): Value;
export function snapshotPortableValue(value: unknown): PortableValue;
export function snapshotPortableValue(value: unknown): PortableValue {
    try {
        return snapshotPortableJsonValue(value, validatePortableValue);
    } catch (error: unknown) {
        throw new TypeError('Portable inputs require lossless, acyclic JSON.', { cause: error });
    }
}
