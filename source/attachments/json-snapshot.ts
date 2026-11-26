import type { JsonValue, ReadonlyDeep } from 'type-fest';
import { createStoredValue } from '../stored-value.ts';

type JsonSnapshot = { readonly value: ReadonlyDeep<JsonValue>; readonly encoded: string; };
type JsonContainer = Readonly<Record<PropertyKey, unknown>> | readonly unknown[];
type JsonObjectPolicy = 'enumerable' | 'portable';
type JsonVisit = (value: unknown, depth: number) => ReadonlyDeep<JsonValue>;
type JsonSnapshotBudget = {
    readonly reserveValue: (value: boolean | number | string | null, separatorBytes: number) => void;
    readonly reserve: (bytes: number) => void;
    readonly enter: (value: JsonContainer) => void;
    readonly leave: (value: JsonContainer) => void;
    readonly contains: (value: JsonContainer) => boolean;
};
type JsonTraversal = {
    readonly budget: JsonSnapshotBudget;
    readonly policy: JsonObjectPolicy;
    readonly visit: JsonVisit;
};

export const maxJsonDepth = 64;
const containerBytes = 2;
class JsonByteLimitError extends Error {
    public constructor() {
        super('JSON attachment exceeds its byte limit.');
        this.name = 'JsonByteLimitError';
    }
}
function createJsonSnapshotBudget(maxBytes: number): JsonSnapshotBudget {
    const ancestors = new Set<JsonContainer>();
    const remaining = createStoredValue(maxBytes);
    const bounded = maxBytes !== Number.POSITIVE_INFINITY;
    function reserve(bytes: number): void {
        if (bytes > remaining.read()) {
            throw new JsonByteLimitError();
        }
        remaining.write(remaining.read() - bytes);
    }
    return {
        reserve,
        reserveValue(value, separatorBytes) {
            if (bounded) {
                reserve(Buffer.byteLength(JSON.stringify(value)) + separatorBytes);
            }
        },
        enter(value) {
            ancestors.add(value);
        },
        leave(value) {
            ancestors.delete(value);
        },
        contains(value) {
            return ancestors.has(value);
        }
    };
}
function scalar(value: unknown): value is boolean | number | string | null {
    return value === null || typeof value === 'boolean' || typeof value === 'string' ||
        typeof value === 'number' && Number.isFinite(value);
}
function validatePortableJsonProperty(
    key: PropertyKey,
    descriptor: Readonly<PropertyDescriptor> | undefined
): void {
    if (typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Portable inputs require enumerable string data properties.');
    }
}

function descriptorValue(descriptor: Readonly<PropertyDescriptor> | undefined): unknown {
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('JSON attachments cannot contain sparse arrays or accessors.');
    }
    return descriptor.value;
}
function validatePortableArrayKey(value: readonly unknown[], key: PropertyKey): void {
    if (key === 'length') {
        return;
    }
    validatePortableJsonProperty(key, Object.getOwnPropertyDescriptor(value, key));
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/v.test(key) || Number(key) >= value.length) {
        throw new TypeError('Portable arrays cannot contain additional properties.');
    }
}

function validatePortableArrayKeys(value: readonly unknown[]): void {
    const keys = Reflect.ownKeys(value);
    const dense = keys.length === value.length + 1 && keys.every(function indexKey(key, index) {
        return key === (index === value.length ? 'length' : String(index));
    });
    if (!dense) {
        keys.forEach(function validateKey(key) {
            validatePortableArrayKey(value, key);
        });
    }
}

function readPropertyDescriptor(
    value: JsonContainer,
    key: PropertyKey,
    policy: JsonObjectPolicy
): Readonly<PropertyDescriptor> | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (policy === 'portable' && (descriptor !== undefined || !Array.isArray(value))) {
        validatePortableJsonProperty(key, descriptor);
    }
    return descriptor;
}

function arraySnapshot(value: readonly unknown[], traversal: JsonTraversal, depth: number): ReadonlyDeep<JsonValue> {
    const { budget, policy, visit } = traversal;
    if (policy === 'portable') {
        validatePortableArrayKeys(value);
    }
    const entries: ReadonlyDeep<JsonValue>[] = [];
    for (let index = 0; index < value.length; index += 1) {
        budget.reserve(index === 0 ? 0 : 1);
        const descriptor = readPropertyDescriptor(value, String(index), policy);
        entries.push(visit(descriptorValue(descriptor), depth + 1));
    }
    return Object.freeze(entries);
}
function objectSnapshot(value: JsonContainer, traversal: JsonTraversal, depth: number): ReadonlyDeep<JsonValue> {
    const { budget, policy, visit } = traversal;
    const entries: [string, ReadonlyDeep<JsonValue>][] = [];
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = readPropertyDescriptor(value, key, policy);
        if (descriptor?.enumerable === true) {
            if (typeof key !== 'string') {
                throw new TypeError('JSON attachments cannot contain symbol keys.');
            }
            budget.reserveValue(key, 1 + (entries.length === 0 ? 0 : 1));
            entries.push([ key, visit(descriptorValue(descriptor), depth + 1) ]);
        }
    }
    return Object.freeze(Object.fromEntries(entries));
}
function isContainer(value: unknown): value is JsonContainer {
    return typeof value === 'object' && value !== null;
}
function validateContainer(value: JsonContainer, budget: JsonSnapshotBudget, depth: number): void {
    if (depth > maxJsonDepth || budget.contains(value)) {
        throw new TypeError('Attachments require finite, acyclic JSON values with depth at most 64.');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('JSON attachments require plain objects and arrays.');
    }
    budget.reserve(containerBytes);
    budget.enter(value);
}
function containerSnapshot(value: JsonContainer, traversal: JsonTraversal, depth: number): ReadonlyDeep<JsonValue> {
    return Array.isArray(value) ? arraySnapshot(value, traversal, depth) : objectSnapshot(value, traversal, depth);
}
function createJsonVisit(
    budget: JsonSnapshotBudget,
    validate: (value: unknown) => void,
    policy: JsonObjectPolicy
): JsonVisit {
    const traversal = { budget, policy, visit };
    function visit(value: unknown, depth: number): ReadonlyDeep<JsonValue> {
        validate(value);
        if (scalar(value)) {
            budget.reserveValue(value, 0);
            return value;
        }
        if (!isContainer(value)) {
            throw new TypeError('Attachments require finite JSON values.');
        }
        validateContainer(value, budget, depth);
        try {
            return containerSnapshot(value, traversal, depth);
        } finally {
            budget.leave(value);
        }
    }
    return visit;
}
function boundedJsonSnapshot(value: unknown, maxBytes: number): JsonSnapshot {
    const copy = createJsonVisit(createJsonSnapshotBudget(maxBytes), function allowJsonValue() {
        return undefined;
    }, 'enumerable')(value, 0);
    return { value: copy, encoded: JSON.stringify(copy) };
}
export function snapshotValidatedJsonValue(
    value: unknown,
    validate: (value: unknown) => void
): ReadonlyDeep<JsonValue> {
    return createJsonVisit(createJsonSnapshotBudget(Number.POSITIVE_INFINITY), validate, 'enumerable')(value, 0);
}
export function snapshotPortableJsonValue(
    value: unknown,
    validate: (value: unknown) => void
): ReadonlyDeep<JsonValue> {
    return createJsonVisit(createJsonSnapshotBudget(Number.POSITIVE_INFINITY), validate, 'portable')(value, 0);
}

export function snapshotValidatedJson(value: unknown, validate: (value: unknown) => void): JsonSnapshot {
    const copy = snapshotValidatedJsonValue(value, validate);
    return { value: copy, encoded: JSON.stringify(copy) };
}
export function snapshotJson(value: unknown, maxBytes: number): JsonSnapshot | null {
    try {
        return boundedJsonSnapshot(value, maxBytes);
    } catch (error: unknown) {
        if (error instanceof JsonByteLimitError) {
            return null;
        }
        throw error;
    }
}
