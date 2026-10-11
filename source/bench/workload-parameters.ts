import type { JsonObject, JsonValue, ReadonlyDeep } from 'type-fest';
import { snapshotValidatedJson } from '../attachments/json-snapshot.ts';

export type WorkloadParameters = ReadonlyDeep<JsonObject>;
type JsonParameterContainer = Readonly<Record<PropertyKey, unknown>> | readonly unknown[];

function isParameterRecord(value: ReadonlyDeep<JsonValue>): value is WorkloadParameters {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): value is JsonParameterContainer {
    return typeof value === 'object' && value !== null;
}

function readDataKey(value: JsonParameterContainer, key: PropertyKey): string {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Workload parameters require enumerable string data properties.');
    }
    return key;
}

function isArrayIndex(key: string, length: number): boolean {
    return /^(?:0|[1-9]\d*)$/v.test(key) && Number(key) < length;
}

function parameterKeys(value: JsonParameterContainer): readonly string[] {
    return Reflect
        .ownKeys(value)
        .filter(function dataKey(key) {
            return !Array.isArray(value) || key !== 'length';
        })
        .map(function validatedKey(key) {
            const name = readDataKey(value, key);
            if (Array.isArray(value) && !isArrayIndex(name, value.length)) {
                throw new TypeError('Workload arrays cannot contain additional properties.');
            }
            return name.normalize('NFC');
        });
}

function validateParameterContainer(value: JsonParameterContainer): void {
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('Workload parameters require ordinary JSON arrays.');
    }
    const keys = parameterKeys(value);
    const distinctKeys = new Set(keys);
    if (distinctKeys.size !== keys.length) {
        throw new TypeError('Workload parameter keys must be distinct after Unicode normalization.');
    }
}

function validateParameterValue(value: unknown): void {
    if (Object.is(value, -0)) {
        throw new TypeError('Workload parameters cannot contain negative zero.');
    }
    if (isContainer(value)) {
        validateParameterContainer(value);
    }
}

function snapshotParameters(value: unknown): ReadonlyDeep<JsonValue> {
    try {
        return snapshotValidatedJson(value, validateParameterValue).value;
    } catch (error: unknown) {
        throw new TypeError('workload() requires lossless, acyclic JSON parameters with depth at most 64.', {
            cause: error
        });
    }
}

export function snapshotWorkloadParameters(value: unknown): WorkloadParameters {
    const snapshot = snapshotParameters(value);
    if (!isParameterRecord(snapshot)) {
        throw new TypeError('workload() requires a JSON parameter record.');
    }
    return snapshot;
}
