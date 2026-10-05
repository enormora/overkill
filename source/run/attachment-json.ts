import type { JsonValue, ReadonlyDeep } from 'type-fest';
import { createStoredRunValue } from './supervised-run-state.ts';

type JsonSnapshot = { readonly value: ReadonlyDeep<JsonValue>; readonly encoded: string; };
type JsonContainer = Readonly<Record<PropertyKey, unknown>> | readonly unknown[];
type JsonVisit = (value: unknown, depth: number) => ReadonlyDeep<JsonValue>;
type JsonSnapshotBudget = {
    readonly reserve: (bytes: number) => void;
    readonly enter: (value: JsonContainer) => void;
    readonly leave: (value: JsonContainer) => void;
    readonly contains: (value: JsonContainer) => boolean;
};
const maxJsonDepth = 64;
const containerBytes = 2;
class JsonByteLimitError extends Error {
    public constructor() {
        super('JSON attachment exceeds its byte limit.');
        this.name = 'JsonByteLimitError';
    }
}
function createJsonSnapshotBudget(maxBytes: number): JsonSnapshotBudget {
    const ancestors = new Set<JsonContainer>();
    const remaining = createStoredRunValue(maxBytes);
    return {
        reserve(bytes) {
            if (bytes > remaining.read()) {
                throw new JsonByteLimitError();
            }
            remaining.write(remaining.read() - bytes);
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
function descriptorValue(descriptor: Readonly<PropertyDescriptor> | undefined): unknown {
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('JSON attachments cannot contain sparse arrays or accessors.');
    }
    return descriptor.value;
}
function arraySnapshot(
    value: readonly unknown[],
    budget: JsonSnapshotBudget,
    depth: number,
    visit: JsonVisit
): ReadonlyDeep<JsonValue> {
    const entries: ReadonlyDeep<JsonValue>[] = [];
    for (let index = 0; index < value.length; index += 1) {
        budget.reserve(index === 0 ? 0 : 1);
        entries.push(visit(descriptorValue(Object.getOwnPropertyDescriptor(value, String(index))), depth + 1));
    }
    return Object.freeze(entries);
}
function objectSnapshot(
    value: JsonContainer,
    budget: JsonSnapshotBudget,
    depth: number,
    visit: JsonVisit
): ReadonlyDeep<JsonValue> {
    const entries: Record<string, ReadonlyDeep<JsonValue>> = {};
    const keys = Reflect.ownKeys(value).filter(function enumerableKey(key) {
        return Object.getOwnPropertyDescriptor(value, key)?.enumerable === true;
    });
    for (const [ index, key ] of keys.entries()) {
        if (typeof key !== 'string') {
            throw new TypeError('JSON attachments cannot contain symbol keys.');
        }
        budget.reserve(Buffer.byteLength(JSON.stringify(key)) + 1 + (index === 0 ? 0 : 1));
        Object.defineProperty(entries, key, {
            enumerable: true,
            value: visit(descriptorValue(Object.getOwnPropertyDescriptor(value, key)), depth + 1)
        });
    }
    return Object.freeze(entries);
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
function containerSnapshot(
    value: JsonContainer,
    budget: JsonSnapshotBudget,
    depth: number,
    visit: JsonVisit
): ReadonlyDeep<JsonValue> {
    return Array.isArray(value)
        ? arraySnapshot(value, budget, depth, visit)
        : objectSnapshot(value, budget, depth, visit);
}
function createJsonVisit(budget: JsonSnapshotBudget): JsonVisit {
    return function visit(value, depth) {
        if (scalar(value)) {
            budget.reserve(Buffer.byteLength(JSON.stringify(value)));
            return value;
        }
        if (!isContainer(value)) {
            throw new TypeError('Attachments require finite JSON values.');
        }
        validateContainer(value, budget, depth);
        try {
            return containerSnapshot(value, budget, depth, visit);
        } finally {
            budget.leave(value);
        }
    };
}
function boundedJsonSnapshot(value: unknown, maxBytes: number): JsonSnapshot {
    const copy = createJsonVisit(createJsonSnapshotBudget(maxBytes))(value, 0);
    return { value: copy, encoded: JSON.stringify(copy) };
}
export function snapshotAttachmentJson(value: unknown, maxBytes: number): JsonSnapshot | null {
    try {
        return boundedJsonSnapshot(value, maxBytes);
    } catch (error: unknown) {
        if (error instanceof JsonByteLimitError) {
            return null;
        }
        throw error;
    }
}
